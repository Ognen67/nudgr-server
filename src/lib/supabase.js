import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
// Load environment variables FIRST before any other imports
dotenv.config();
// Check if we have valid Supabase configuration
const hasValidSupabaseConfig = () => {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  
  console.log('🔍 Supabase Config Validation:');
  console.log('  SUPABASE_URL:', url ? 'SET' : 'MISSING');
  console.log('  SUPABASE_SERVICE_ROLE_KEY:', serviceKey ? 'SET' : 'MISSING');
  console.log('  SUPABASE_ANON_KEY:', anonKey ? 'SET' : 'MISSING');
  
  if (!url) {
    console.log('❌ SUPABASE_URL is missing');
    return false;
  }
  if (!serviceKey) {
    console.log('❌ SUPABASE_SERVICE_ROLE_KEY is missing');
    return false;
  }
  if (!anonKey) {
    console.log('❌ SUPABASE_ANON_KEY is missing');
    return false;
  }
  if (url === 'https://placeholder.supabase.co') {
    console.log('❌ SUPABASE_URL is still placeholder');
    return false;
  }
  if (serviceKey === 'placeholder-service-role-key') {
    console.log('❌ SUPABASE_SERVICE_ROLE_KEY is still placeholder');
    return false;
  }
  if (anonKey === 'placeholder-anon-key') {
    console.log('❌ SUPABASE_ANON_KEY is still placeholder');
    return false;
  }
  if (!url.includes('.supabase.co')) {
    console.log('❌ SUPABASE_URL does not contain .supabase.co');
    return false;
  }
  
  console.log('✅ All Supabase config validation passed');
  return true;
};

// Initialize clients only if configuration is valid
let supabaseAdmin = null;
let supabaseClient = null;

console.log('🚀 Initializing Supabase...');
if (hasValidSupabaseConfig()) {
  try {
    console.log('🔧 Creating Supabase clients...');
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
    console.log('✅ supabaseAdmin is now:', !!supabaseAdmin);
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