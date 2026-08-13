// ============================================================
// supabase-config.js - CONFIGURACIÓN DE SUPABASE
// ============================================================

// 🔑 REEMPLAZA ESTOS VALORES CON LOS TUYOS
export const SUPABASE_CONFIG = {
    // URL del proyecto (de Settings > API)
    supabaseUrl: 'https://TU-PROYECTO.supabase.co',
    
    // Clave anónima (de Settings > API > anon public)
    supabaseAnonKey: 'TU-ANON-KEY-AQUI',
    
    // Clave de servicio (de Settings > API > service_role secret)
    // ⚠️ GUARDA ESTA CLAVE, ES PARA OPERACIONES ADMIN
    supabaseServiceKey: 'TU-SERVICE-KEY-AQUI'
};

// ============================================================
// FUNCIÓN PARA PROBAR LA CONEXIÓN
// ============================================================

export async function testSupabaseConnection() {
    try {
        const response = await fetch(`${SUPABASE_CONFIG.supabaseUrl}/rest/v1/`, {
            headers: {
                'apikey': SUPABASE_CONFIG.supabaseAnonKey,
                'Authorization': `Bearer ${SUPABASE_CONFIG.supabaseAnonKey}`
            }
        });
        
        if (response.ok) {
            console.log('✅ Conexión a Supabase exitosa');
            return true;
        } else {
            console.error('❌ Error de conexión:', response.status);
            return false;
        }
    } catch (error) {
        console.error('❌ Error:', error);
        return false;
    }
}