import {createClient} from '@supabase/supabase-js';
const url=import.meta.env.VITE_SUPABASE_URL || 'https://xwzxgazwqehcpyhrbord.supabase.co';
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_ZniynmHgPon-5oAMQnHF1w_I6gMYtN8';
export const configured=Boolean(url&&key);
export const supabase=createClient(url,key);
