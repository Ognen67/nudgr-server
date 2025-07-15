import { createClient } from '@supabase/supabase-js';

// Check if we have valid Supabase configuration
const hasValidSupabaseConfig = () => {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  
  return url && 
         serviceKey && 
         anonKey &&
         url !== 'https://placeholder.supabase.co' &&
         serviceKey !== 'placeholder-service-role-key' &&
         anonKey !== 'placeholder-anon-key' &&
         url.includes('.supabase.co');
};

// Initialize clients only if configuration is valid
let supabaseAdmin = null;
let supabaseClient = null;

if (hasValidSupabaseConfig()) {
  try {
    // Supabase client for admin operations (uses service role key)
    supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // Supabase client for client operations (uses anon key)
    supabaseClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
    
    console.log('✅ Supabase clients initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing Supabase clients:', error);
    supabaseAdmin = null;
    supabaseClient = null;
  }
} else {
  console.warn('⚠️  Supabase configuration is missing or invalid. Please check your environment variables:');
  console.warn('   - SUPABASE_URL should be your project URL (https://your-project.supabase.co)');
  console.warn('   - SUPABASE_SERVICE_ROLE_KEY should be your service role key');
  console.warn('   - SUPABASE_ANON_KEY should be your anon key');
  console.warn('   - SUPABASE_JWKS_URL should be your JWKS URL');
  console.warn('   Authentication will not work until these are properly configured.');
}

export { supabaseAdmin, supabaseClient, hasValidSupabaseConfig };
export default supabaseAdmin;