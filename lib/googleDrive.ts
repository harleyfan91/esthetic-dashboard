export const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid'
].join(' ');

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

export class GoogleDriveService {
  private clientId: string;
  private fallbackApiKey: string;
  private tokenClient: any;
  private accessToken: string | null = null;
  private pickerReady: boolean = false;

  constructor(clientId: string, apiKey: string) {
    this.clientId = (clientId || '').trim();
    this.fallbackApiKey = (apiKey || '').trim();
  }

  private getEffectiveApiKey(): string {
    return (import.meta.env.VITE_GOOGLE_API_KEY || this.fallbackApiKey || '').trim();
  }

  private libsReady(): boolean {
    return !!(window.google?.accounts?.oauth2 && window.gapi);
  }

  async initGis(): Promise<void> {
    let attempts = 0;
    while (!this.libsReady() && attempts < 15) {
      await new Promise(resolve => setTimeout(resolve, 200));
      attempts++;
    }
    if (!window.google?.accounts?.oauth2) return;
    try {
      this.tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPES,
        callback: (response: any) => {
          if (response.error !== undefined) return;
          this.accessToken = response.access_token;
        },
      });
      window.gapi.load('picker', {
        callback: () => { this.pickerReady = true; },
        onerror: () => { console.warn("Picker failed to load."); }
      });
    } catch (err) {
      console.error("GIS init error:", err);
    }
  }

  async authenticate(): Promise<string> {
    if (!this.tokenClient) await this.initGis();
    return new Promise((resolve, reject) => {
      if (!this.tokenClient) return reject(new Error("Google Auth libraries not ready. Please refresh."));
      this.tokenClient.callback = (response: any) => {
        if (response.error) return reject(response);
        this.accessToken = response.access_token;
        resolve(this.accessToken!);
      };
      this.tokenClient.requestAccessToken({ prompt: 'consent' });
    });
  }

  getStoredToken() { return this.accessToken; }
  
  openPicker(token: string, onPicked: (file: any) => void) {
    if (!window.google?.picker) {
      window.gapi.load('picker', {
        callback: () => this.showPicker(token, onPicked),
        onerror: () => alert("Could not load the file selector.")
      });
      return;
    }
    this.showPicker(token, onPicked);
  }

  private async showPicker(token: string, onPicked: (file: any) => void) {
    const origin = window.location.origin;
    const apiKey = this.getEffectiveApiKey();
    
    if (!apiKey) {
      alert("A Google API Key is required. Please check your Cloudflare settings.");
      return;
    }

    const allowedTypes = [
      'application/vnd.google-apps.folder', 'text/csv', 'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.google-apps.spreadsheet', 'application/json', 'text/plain'
    ].join(',');

    const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS)
      .setIncludeFolders(true)
      .setMimeTypes(allowedTypes);

    const picker = new window.google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey) 
      .setOrigin(origin)
      .setCallback((data: any) => {
        if (data.action === window.google.picker.Action.PICKED) {
          onPicked(data.docs[0]);
        }
      })
      .enableFeature(window.google.picker.Feature.SUPPORT_DRIVES)
      .build();

    picker.setVisible(true);
  }

  // ✅ UPDATED: Requests 'webViewLink' so we can open the file in a new tab
  async findFileByName(name: string) {
    if (!this.accessToken) return null;
    const q = encodeURIComponent(`name = '${name}' and trashed = false`);
    try {
      const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,webViewLink)`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      const data = await response.json();
      return data.files?.[0] || null;
    } catch (e) { return null; }
  }

  // ✅ UPDATED: Returns the file metadata (including link) after save
  async saveJsonToCloud(name: string, content: any) {
    if (!this.accessToken) return null;
    try {
      const existingFile = await this.findFileByName(name);
      const metadata = { name, mimeType: 'application/json' };
      const jsonString = JSON.stringify(content);
      
      const boundary = '-------314159265358979323846';
      const delimiter = "\r\n--" + boundary + "\r\n";
      const close_delim = "\r\n--" + boundary + "--";
      
      const multipartRequestBody = 
        delimiter + 
        'Content-Type: application/json\r\n\r\n' + 
        JSON.stringify(metadata) + 
        delimiter + 
        'Content-Type: application/json\r\n\r\n' + 
        jsonString + 
        close_delim;

      // Add 'fields' param to get the webViewLink back
      const baseUrl = existingFile 
        ? `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}` 
        : `https://www.googleapis.com/upload/drive/v3/files`;
        
      const url = `${baseUrl}?uploadType=multipart&fields=id,name,webViewLink`;

      const response = await fetch(url, {
        method: existingFile ? 'PATCH' : 'POST',
        headers: { 
          Authorization: `Bearer ${this.accessToken}`, 
          'Content-Type': 'multipart/related; boundary=' + boundary 
        },
        body: multipartRequestBody
      });
      
      return await response.json(); // Returns file object with webViewLink
    } catch (e) { 
      console.error("Cloud save failed", e); 
      return null;
    }
  }

  async downloadFile(fileId: string, mimeType?: string): Promise<any> {
    const isGoogleSheet = mimeType === 'application/vnd.google-apps.spreadsheet';
    const url = isGoogleSheet ? `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv` : `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${this.accessToken}` } });
    if (!response.ok) throw new Error("Download failed.");
    const contentType = response.headers.get('content-type');
    return contentType?.includes('application/json') ? response.json() : response.blob();
  }
}
