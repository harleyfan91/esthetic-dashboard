import React, { useState } from 'react';
import { LayoutDashboard, CloudUpload, BarChart3, X, LogOut, User, Cloud, RefreshCw } from 'lucide-react';
import { ViewState } from '../types';

interface LayoutProps {
  children: React.ReactNode;
  currentView: ViewState;
  setView: (view: ViewState) => void;
  masterName?: string;
  googleUser?: any;
  onSignOut?: () => void;
  cloudSyncing?: boolean;
}

export const Layout: React.FC<LayoutProps> = ({ 
  children, currentView, setView, masterName, googleUser, onSignOut, cloudSyncing 
}) => {
  const [showAccount, setShowAccount] = useState(false);

  const navItems = [
    { id: 'sync' as ViewState, label: 'Add Sales Data', icon: CloudUpload },
    { id: 'analyze' as ViewState, label: 'Sales Dashboard', icon: BarChart3 },
  ];

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Account Modal */}
      {showAccount && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] p-10 max-w-sm w-full shadow-2xl animate-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-xl font-black text-slate-900">Your Account</h3>
              <button onClick={() => setShowAccount(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-8 h-8" />
              </button>
            </div>

            <div className="flex flex-col items-center text-center mb-8">
              <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mb-4 overflow-hidden border-4 border-white shadow-md">
                {googleUser?.picture ? (
                  <img src={googleUser.picture} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-8 h-8 text-indigo-400" />
                )}
              </div>
              <p className="text-lg font-black text-slate-900">{googleUser?.name || 'Authorized User'}</p>
              <p className="text-sm font-medium text-slate-400">{googleUser?.email || 'Connected via Cloudflare'}</p>
              
              <div className={`mt-4 px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-full border flex items-center gap-1.5 transition-colors ${
                cloudSyncing ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'
              }`}>
                {cloudSyncing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Cloud className="w-3 h-3" />}
                {cloudSyncing ? 'Syncing to Drive...' : 'Linked to Google Drive'}
              </div>
            </div>

            <button
              onClick={onSignOut}
              className="w-full text-red-500 py-4 rounded-2xl font-bold hover:bg-red-50 transition-all flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 hidden md:flex flex-col sticky top-0 h-screen">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-md text-white">
            <LayoutDashboard className="w-5 h-5" />
          </div>
          <h1 className="text-lg font-black text-slate-900 tracking-tight">Esthetic</h1>
          {cloudSyncing && <RefreshCw className="w-3 h-3 text-indigo-400 animate-spin ml-auto" />}
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              disabled={!masterName}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                currentView === item.id
                  ? 'bg-indigo-50 text-indigo-700 font-bold shadow-sm'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
              } ${!masterName ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-100">
          <button 
            onClick={() => setShowAccount(true)}
            className="w-full bg-slate-50 hover:bg-indigo-50 rounded-xl p-4 flex items-center gap-3 transition-colors group"
          >
            <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-sm overflow-hidden">
              {googleUser?.picture ? (
                <img src={googleUser.picture} className="w-8 h-8 rounded-full" alt="User" />
              ) : (
                <User className="w-4 h-4 text-slate-400" />
              )}
            </div>
            <div className="overflow-hidden text-left">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest group-hover:text-indigo-400">Account</p>
              <p className="text-sm font-bold text-slate-700 truncate">
                {cloudSyncing ? 'Saving...' : (googleUser?.name || 'Active')}
              </p>
            </div>
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-4 md:p-8 pt-20 md:pt-8">
        <div className="max-w-6xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
};
