// QuOLab Nexus — configuración pública de Supabase.
// Solo contiene la clave publishable/anon. Nunca colocar service_role aquí.
export const QUOLAB_NEXUS_SUPABASE_CONFIG = Object.freeze({
    supabaseUrl: "https://rtkcfbnoqbivylejhspv.supabase.co",
    supabaseAnonKey: "sb_publishable_Uw4ViBXo3UvvlSHzOiAcDA_9Jn6eMcf"
});
// Alias temporal para código de módulos que todavía importa el nombre anterior.
export const SUPABASE_CONFIG = QUOLAB_NEXUS_SUPABASE_CONFIG;
