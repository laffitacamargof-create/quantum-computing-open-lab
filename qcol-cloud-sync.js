// ============================================================
//  QCOL Cloud Sync — Sincronización automática e invisible
//  Versión 1.0
//  (c) 2026 QCOL Ecosystem
//  Licencia: MIT
// ============================================================
(function() {
    'use strict';

    // ──────────────────────────────────────────────────────────
    // 1. CONFIGURACIÓN (valores por defecto, pueden sobrescribirse)
    // ──────────────────────────────────────────────────────────

    const DEFAULTS = {
        // URL de PocketBase (puede cambiarse vía localStorage)
        pocketbase_url: localStorage.getItem('qcol_pb_url') || 'http://localhost:8090',
        // Colección y registro donde se guardarán los datos públicos
        collection: 'public_data',
        record_id: 'global',
        // Intervalo de sincronización (ms)
        sync_interval: 30000, // 30 segundos
        // Si debe fusionar automáticamente cambios en conflicto
        auto_merge: true
    };

    // Claves de localStorage que se consideran "públicas" y se sincronizan
    const PUBLIC_KEYS = [
        'qcol_projs',                       // Proyectos
        'qcol_library',                     // Biblioteca
        'qcol_published_quantum_apps',      // Apps publicadas (Quantum Puzzle)
        'qcol_pending_quantum_apps',        // Apps pendientes (Quantum Puzzle)
        'qcol_colab_url',                   // URL del compilador
        'qcol_ai',                          // Configuración de IA
        'qcol_gh',                          // Configuración de GitHub
        'qcol_cfg',                         // Configuración de plataforma
        'qcol_sys',                         // Configuración de sistema
        'qcol_monitor_cfg'                  // Límites del monitor
    ];

    // ──────────────────────────────────────────────────────────
    // 2. ESTADO INTERNO
    // ──────────────────────────────────────────────────────────

    let pb = null;                       // Cliente PocketBase
    let isSyncing = false;               // Evita sincronizaciones simultáneas
    let lastSyncTimestamp = null;        // Última vez que se sincronizó
    let syncTimeout = null;              // Timeout para programar sincronización

    // ──────────────────────────────────────────────────────────
    // 3. FUNCIONES DE INICIALIZACIÓN DE POCKETBASE
    // ──────────────────────────────────────────────────────────

    function loadPocketBase() {
        // Cargar la librería PocketBase desde CDN si no está disponible
        if (typeof PocketBase !== 'undefined') {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/pocketbase@0.21.0/dist/pocketbase.umd.min.js';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('No se pudo cargar PocketBase SDK'));
            document.head.appendChild(script);
        });
    }

    async function initPocketBase() {
        try {
            await loadPocketBase();
            pb = new PocketBase(DEFAULTS.pocketbase_url);
            // Intentar autenticación anónima (si está habilitada en PocketBase)
            // Si no, se usará sin autenticación (solo lectura pública si está configurada)
            try {
                await pb.collection('users').authWithPassword(
                    localStorage.getItem('qcol_pb_email') || 'admin@qcol.com',
                    localStorage.getItem('qcol_pb_password') || 'admin123'
                );
                console.log('[QCOL Cloud] Autenticado en PocketBase');
            } catch (authError) {
                console.log('[QCOL Cloud] Autenticación no requerida, usando acceso público');
            }
            return true;
        } catch (error) {
            console.warn('[QCOL Cloud] Error inicializando PocketBase:', error.message);
            return false;
        }
    }

    // ──────────────────────────────────────────────────────────
    // 4. FUNCIONES DE LECTURA/ESCRITURA DE DATOS
    // ──────────────────────────────────────────────────────────

    // Extrae todos los datos públicos del localStorage actual
    function extractPublicData() {
        const data = {
            projects: JSON.parse(localStorage.getItem('qcol_projs') || '[]'),
            library: JSON.parse(localStorage.getItem('qcol_library') || '[]'),
            puzzle: JSON.parse(localStorage.getItem('qcol_published_quantum_apps') || '[]'),
            pending: JSON.parse(localStorage.getItem('qcol_pending_quantum_apps') || '[]'),
            config: {
                colab_url: localStorage.getItem('qcol_colab_url') || '',
                ai: JSON.parse(localStorage.getItem('qcol_ai') || '{}'),
                github: JSON.parse(localStorage.getItem('qcol_gh') || '{}'),
                platform: JSON.parse(localStorage.getItem('qcol_cfg') || '{}'),
                system: JSON.parse(localStorage.getItem('qcol_sys') || '{}'),
                monitor: JSON.parse(localStorage.getItem('qcol_monitor_cfg') || '{}')
            },
            timestamp: new Date().toISOString(),
            version: '2.0.0'
        };
        return data;
    }

    // Aplica datos descargados de la nube al localStorage
    function applyCloudData(cloudData) {
        if (!cloudData) return false;

        let updated = false;

        // Solo actualizar si el timestamp es más reciente que el local
        const localTimestamp = localStorage.getItem('_qcol_cloud_timestamp') || '1970-01-01T00:00:00.000Z';
        if (cloudData.timestamp && cloudData.timestamp <= localTimestamp) {
            return false; // No hay datos más nuevos
        }

        // Actualizar cada clave
        if (cloudData.projects !== undefined) {
            localStorage.setItem('qcol_projs', JSON.stringify(cloudData.projects));
            updated = true;
        }
        if (cloudData.library !== undefined) {
            localStorage.setItem('qcol_library', JSON.stringify(cloudData.library));
            updated = true;
        }
        if (cloudData.puzzle !== undefined) {
            localStorage.setItem('qcol_published_quantum_apps', JSON.stringify(cloudData.puzzle));
            updated = true;
        }
        if (cloudData.pending !== undefined) {
            localStorage.setItem('qcol_pending_quantum_apps', JSON.stringify(cloudData.pending));
            updated = true;
        }
        if (cloudData.config) {
            const cfg = cloudData.config;
            if (cfg.colab_url) localStorage.setItem('qcol_colab_url', cfg.colab_url);
            if (cfg.ai) localStorage.setItem('qcol_ai', JSON.stringify(cfg.ai));
            if (cfg.github) localStorage.setItem('qcol_gh', JSON.stringify(cfg.github));
            if (cfg.platform) localStorage.setItem('qcol_cfg', JSON.stringify(cfg.platform));
            if (cfg.system) localStorage.setItem('qcol_sys', JSON.stringify(cfg.system));
            if (cfg.monitor) localStorage.setItem('qcol_monitor_cfg', JSON.stringify(cfg.monitor));
            updated = true;
        }

        if (updated && cloudData.timestamp) {
            localStorage.setItem('_qcol_cloud_timestamp', cloudData.timestamp);
        }

        return updated;
    }

    // ──────────────────────────────────────────────────────────
    // 5. FUNCIONES DE SINCRONIZACIÓN CON LA NUBE
    // ──────────────────────────────────────────────────────────

    // Sube los datos locales a la nube (PocketBase)
    async function uploadToCloud() {
        if (!pb) return false;
        try {
            const data = extractPublicData();

            // Intentar actualizar el registro existente o crearlo
            let record;
            try {
                record = await pb.collection(DEFAULTS.collection).getOne(DEFAULTS.record_id);
                // Actualizar
                await pb.collection(DEFAULTS.collection).update(DEFAULTS.record_id, data);
            } catch (e) {
                // Si no existe, crearlo
                await pb.collection(DEFAULTS.collection).create({
                    id: DEFAULTS.record_id,
                    ...data
                });
            }

            // Guardar timestamp local
            localStorage.setItem('_qcol_cloud_timestamp', data.timestamp);
            lastSyncTimestamp = data.timestamp;
            console.log('[QCOL Cloud] Datos subidos a la nube correctamente');
            return true;
        } catch (error) {
            console.warn('[QCOL Cloud] Error subiendo a la nube:', error.message);
            return false;
        }
    }

    // Descarga los datos de la nube y los aplica localmente
    async function downloadFromCloud() {
        if (!pb) return false;
        try {
            const record = await pb.collection(DEFAULTS.collection).getOne(DEFAULTS.record_id);
            if (!record) return false;

            // Aplicar los datos al localStorage
            const updated = applyCloudData(record);
            if (updated) {
                console.log('[QCOL Cloud] Datos descargados de la nube y aplicados');
                // Notificar a los módulos que los datos han cambiado (opcional)
                window.dispatchEvent(new CustomEvent('qcol-cloud-update', { detail: record }));
            } else {
                console.log('[QCOL Cloud] No hay datos más nuevos en la nube');
            }
            return true;
        } catch (error) {
            console.warn('[QCOL Cloud] Error descargando de la nube:', error.message);
            return false;
        }
    }

    // Sincronización completa: sube y luego baja (para asegurar consistencia)
    async function fullSync() {
        if (isSyncing) return;
        isSyncing = true;
        try {
            // Primero subir cambios locales
            await uploadToCloud();
            // Luego bajar posibles cambios de otros usuarios
            await downloadFromCloud();
        } finally {
            isSyncing = false;
        }
    }

    // ──────────────────────────────────────────────────────────
    // 6. INTERCEPTOR DE LOCALSTORAGE
    // ──────────────────────────────────────────────────────────

    // Guardamos la función original para no romper nada
    const originalSetItem = localStorage.setItem;

    // Reemplazamos setItem para detectar cambios en claves públicas
    localStorage.setItem = function(key, value) {
        // Llamar al comportamiento original
        originalSetItem.call(this, key, value);

        // Si es una clave pública, programar sincronización
        if (PUBLIC_KEYS.includes(key)) {
            scheduleSync();
        }
    };

    // También interceptamos removeItem por si se borran claves públicas
    const originalRemoveItem = localStorage.removeItem;
    localStorage.removeItem = function(key) {
        originalRemoveItem.call(this, key);
        if (PUBLIC_KEYS.includes(key)) {
            scheduleSync();
        }
    };

    // Función para programar sincronización con debounce
    function scheduleSync() {
        if (syncTimeout) clearTimeout(syncTimeout);
        syncTimeout = setTimeout(() => {
            fullSync();
            syncTimeout = null;
        }, 500); // Esperar 500ms para acumular cambios
    }

    // ──────────────────────────────────────────────────────────
    // 7. INICIALIZACIÓN Y CICLO DE VIDA
    // ──────────────────────────────────────────────────────────

    async function init() {
        console.log('[QCOL Cloud] Inicializando sincronización...');

        // Inicializar PocketBase
        const ok = await initPocketBase();
        if (!ok) {
            console.warn('[QCOL Cloud] No se pudo conectar a PocketBase. Los datos se mantendrán solo en localStorage.');
            return;
        }

        // Primera sincronización: descargar datos existentes
        await downloadFromCloud();

        // Configurar sincronización periódica
        setInterval(() => {
            // Solo sincronizar si no hay una sincronización en curso
            if (!isSyncing) {
                downloadFromCloud(); // Bajar posibles cambios
                // También subir si hay cambios pendientes (se detectan con el interceptor)
            }
        }, DEFAULTS.sync_interval);

        console.log('[QCOL Cloud] Sincronización activa. Intervalo:', DEFAULTS.sync_interval / 1000, 'segundos');
    }

    // Esperar a que el DOM esté listo
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Exponer algunas funciones para uso en consola (debug)
    window.__QCOL_CLOUD = {
        sync: fullSync,
        upload: uploadToCloud,
        download: downloadFromCloud,
        status: () => ({
            connected: !!pb,
            lastSync: lastSyncTimestamp,
            url: DEFAULTS.pocketbase_url
        })
    };

})();