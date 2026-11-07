// Picks the data layer: LIVE (Supabase configured in config.js) or PREVIEW (demo data in this browser only).
import { createSupabaseApi } from './api-supabase.js';
const cfg = window.SHOPZENT_CONFIG || {};
export const DEMO = !(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
export const api = DEMO ? (await import('./api-demo.js')).createDemoApi() : createSupabaseApi(cfg);
export const config = cfg;
