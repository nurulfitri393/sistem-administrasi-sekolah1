import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://whnwipppzjauxkmdiqfv.supabase.co'
const supabaseAnonKey = 'sb_publishable_szkotq6gG7TVSfBfIumxJQ_92oC5eoH'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)