
export interface SaleRecord {
  id: string;
  date: string;
  product: string;
  category: string;
  amount: number;
  quantity: number;
  customerZip?: string;
}

export interface MasterRecord {
  id: string;
  name: string;
  lastUpdated: string;
  totalSales: number;
  totalRevenue: number;
  data: SaleRecord[];
  syncedFiles?: string[]; 
  googleFileUrl?: string;
  lastStrategicInsight?: string; // Cached AI response
  analysisTimestamp?: string;    // When the analysis was last run
  mappingSchema?: {
    date: string;
    product: string;
    category: string;
    amount: string;
    quantity: string;
  };
}

export interface DashboardStats {
  bestSellers: { name: string; total: number }[];
  revenueTrend: { date: string; revenue: number }[];
  categoryDistribution: { name: string; value: number }[];
}

export type ViewState = 'setup' | 'sync' | 'analyze';
