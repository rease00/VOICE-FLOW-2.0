
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://fupdwsspnakayiqrdadr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1cGR3c3NwbmFrYXlpcXJkYWRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM1NTE0NDQsImV4cCI6MjA3OTEyNzQ0NH0.IHpbzhViiayTwuWvu-a_tAto_U87JlcXOfUk0VW-1kk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Debug check
if (console && console.debug) {
    console.debug('Supabase Client Initialized', { url: SUPABASE_URL });
}
