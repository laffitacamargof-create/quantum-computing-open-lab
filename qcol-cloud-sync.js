// ============================================================
//  QCOL Cloud Sync — Sincronización COMPLETA de Apps
//  Versión 5.0 — Sincroniza TODO (Studio, Pendientes, Publicadas)
//  (c) 2026 QCOL Ecosystem
// ============================================================
(function() {
    'use strict';

    // ──────────────────────────────────────────────────────────
    // 1. CONFIGURACIÓN GITHUB
    // ──────────────────────────────────────────────────────────

    function getGitHubConfig() {
        try {
            const gh = JSON.parse(localStorage.getItem('qcol_gh') || '{}');
            return {
                owner: gh.user || 'laffitacamargof-create',
                repo: gh.repo || 'quantum-computing-open-lab',
                branch: gh.branch || 'main',
                token: gh.token || '',
                path: 'data/public_data.json'
            };
        } catch(e) {
            return {
                owner: 'laffitacamargof-create',
                repo: 'quantum-computing-open-lab',
                branch: 'main',
                token: '',
                path: 'data/public_data.json'
            };
        }
    }

    // ═══ TODAS las claves que se sincronizan ═══
    const SYNC_KEYS = [
        // Apps
        'quantum_apps_repo_v2',           // Studio (todas las apps del usuario)
        'qcol_pending_quantum_apps',      // Pendientes de aprobación
        'qcol_published_quantum_apps',    // Publicadas (visibles para todos)
        
        // Datos públicos
        'qcol_projs',
        'qcol_library',
        
        // Configuración
        'qcol_colab_url',
        'qcol_ai',
        'qcol_gh',
        'qcol_cfg',
        'qcol_sys',
        'qcol_monitor_cfg',
        'qcol_fp'
    ];

    // ──────────────────────────────────────────────────────────
    // 2. ESTADO
    // ──────────────────────────────────────────────────────────

    let isSyncing = false;
    let syncTimeout = null;
    let currentSha = null;

    // ──────────────────────────────────────────────────────────
    // 3. FUNCIONES DE LECTURA/ESCRITURA
    // ──────────────────────────────────────────────────────────

    function safeParse(key, fallback) {
        try {
            const val = localStorage.getItem(key);
            return val ? JSON.parse(val) : fallback;
        } catch(e) {
            return fallback;
        }
    }

    // ═══ Extrae TODOS los datos públicos ═══
    function extractAllData() {
        return {
            // Apps
            quantum_apps: safeParse('quantum_apps_repo_v2', []),
            pending: safeParse('qcol_pending_quantum_apps', []),
            published: safeParse('qcol_published_quantum_apps', []),
            
            // Datos públicos
            projects: safeParse('qcol_projs', []),
            library: safeParse('qcol_library', []),
            
            // Configuración
            config: {
                colab_url: localStorage.getItem('qcol_colab_url') || '',
                ai: safeParse('qcol_ai', {}),
                github: safeParse('qcol_gh', {}),
                platform: safeParse('qcol_cfg', {}),
                system: safeParse('qcol_sys', {}),
                monitor: safeParse('qcol_monitor_cfg', {}),
                founder_pass: localStorage.getItem('qcol_fp') || ''
            },
            timestamp: new Date().toISOString(),
            device: navigator.userAgent || 'unknown',
            version: '5.0.0'
        };
    }

    // ═══ Aplica datos descargados al localStorage ═══
    function applyCloudData(cloudData) {
        if (!cloudData) return false;

        let updated = false;
        const localTimestamp = localStorage.getItem('_qcol_cloud_timestamp') || '1970-01-01T00:00:00.000Z';
        
        // Si los datos de la nube son más antiguos, no actualizar
        if (cloudData.timestamp && cloudData.timestamp <= localTimestamp) {
            return false;
        }

        // ═══ Sincronizar TODAS las claves ═══
        const mappings = {
            'quantum_apps_repo_v2': cloudData.quantum_apps,
            'qcol_pending_quantum_apps': cloudData.pending,
            'qcol_published_quantum_apps': cloudData.published,
            'qcol_projs': cloudData.projects,
            'qcol_library': cloudData.library
        };

        for (const [key, value] of Object.entries(mappings)) {
            if (value !== undefined) {
                const current = safeParse(key, null);
                if (JSON.stringify(current) !== JSON.stringify(value)) {
                    localStorage.setItem(key, JSON.stringify(value));
                    updated = true;
                    console.log(`[QCOL Cloud] 📥 Actualizado: ${key} (${Array.isArray(value) ? value.length : 'ok'})`);
                }
            }
        }

        // Configuración
        if (cloudData.config) {
            const cfg = cloudData.config;
            const configMappings = {
                'qcol_colab_url': cfg.colab_url,
                'qcol_ai': cfg.ai,
                'qcol_gh': cfg.github,
                'qcol_cfg': cfg.platform,
                'qcol_sys': cfg.system,
                'qcol_monitor_cfg': cfg.monitor,
                'qcol_fp': cfg.founder_pass
            };
            
            for (const [key, value] of Object.entries(configMappings)) {
                if (value !== undefined && value !== '') {
                    const current = localStorage.getItem(key);
                    const newValue = typeof value === 'object' ? JSON.stringify(value) : value;
                    if (current !== newValue) {
                        localStorage.setItem(key, newValue);
                        updated = true;
                    }
                }
            }
        }

        if (updated && cloudData.timestamp) {
            localStorage.setItem('_qcol_cloud_timestamp', cloudData.timestamp);
            console.log('[QCOL Cloud] ✅ Datos actualizados desde la nube');
        }

        return updated;
    }

    // ──────────────────────────────────────────────────────────
    // 4. SINCRONIZACIÓN CON GITHUB
    // ──────────────────────────────────────────────────────────

    function getApiUrl(config) {
        return `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${config.path}`;
    }

    async function uploadToGitHub(data) {
        const config = getGitHubConfig();
        
        if (!config.token) {
            console.warn('[QCOL Cloud] ⚠️ Token de GitHub no configurado. Usa el Panel Fundador.');
            return false;
        }

        try {
            const content = JSON.stringify(data, null, 2);
            const encoded = btoa(unescape(encodeURIComponent(content)));

            const body = {
                message: `QCOL Sync: ${new Date().toISOString()}`,
                content: encoded,
                branch: config.branch
            };

            if (currentSha) {
                body.sha = currentSha;
            }

            const url = getApiUrl(config);
            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${config.token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.github.v3+json'
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || `HTTP ${response.status}`);
            }

            const result = await response.json();
            currentSha = result.content.sha;
            
            console.log('[QCOL Cloud] ✅ Datos subidos a GitHub');
            return true;
        } catch (error) {
            console.warn('[QCOL Cloud] ⚠️ Error subiendo a GitHub:', error.message);
            return false;
        }
    }

    async function downloadFromGitHub() {
        const config = getGitHubConfig();
        
        try {
            const url = getApiUrl(config);
            const headers = { 'Accept': 'application/vnd.github.v3+json' };
            
            if (config.token) {
                headers['Authorization'] = `token ${config.token}`;
            }

            const response = await fetch(url, { headers });

            if (response.status === 404) {
                console.log('[QCOL Cloud] ℹ️ Archivo no existe. Se creará en la primera subida.');
                return false;
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            currentSha = result.sha;

            const content = atob(result.content.replace(/\n/g, ''));
            const data = JSON.parse(content);

            const updated = applyCloudData(data);
            if (updated) {
                console.log('[QCOL Cloud] ✅ Datos descargados de GitHub');
            }
            return true;
        } catch (error) {
            console.warn('[QCOL Cloud] ⚠️ Error descargando de GitHub:', error.message);
            return false;
        }
    }

    // ──────────────────────────────────────────────────────────
    // 5. SINCRONIZACIÓN COMPLETA
    // ──────────────────────────────────────────────────────────

    async function fullSync() {
        if (isSyncing) return;
        isSyncing = true;
        
        try {
            console.log('[QCOL Cloud] 🔄 Sincronizando...');
            
            // 1. Descargar datos de GitHub
            await downloadFromGitHub();
            
            // 2. Subir datos locales (para asegurar que GitHub tiene lo último)
            const data = extractAllData();
            await uploadToGitHub(data);
            
            console.log('[QCOL Cloud] ✅ Sincronización completa');
            
            // Notificar a los módulos que los datos cambiaron
            window.dispatchEvent(new CustomEvent('qcol-cloud-update', { 
                detail: { 
                    timestamp: new Date().toISOString(),
                    published: safeParse('qcol_published_quantum_apps', []).length,
                    pending: safeParse('qcol_pending_quantum_apps', []).length
                } 
            }));
            
        } catch(e) {
            console.warn('[QCOL Cloud] ⚠️ Error en sincronización:', e.message);
        } finally {
            isSyncing = false;
        }
    }

    // ──────────────────────────────────────────────────────────
    // 6. INTERCEPTOR DE LOCALSTORAGE
    // ──────────────────────────────────────────────────────────

    const originalSetItem = localStorage.setItem;

    localStorage.setItem = function(key, value) {
        originalSetItem.call(this, key, value);

        if (SYNC_KEYS.includes(key)) {
            scheduleSync();
        }
    };

    function scheduleSync() {
        if (syncTimeout) clearTimeout(syncTimeout);
        syncTimeout = setTimeout(() => {
            fullSync();
            syncTimeout = null;
        }, 1500);
    }

    // ──────────────────────────────────────────────────────────
    // 7. ESCUCHAR EVENTOS
    // ──────────────────────────────────────────────────────────

    window.addEventListener('message', function(e) {
        const data = e.data;
        if (!data || typeof data !== 'object') return;
        
        // Cualquier evento relacionado con apps trigger sincronización
        if (data.type === 'QCOL_APP_SAVED' || 
            data.type === 'QCOL_APP_PUBLISHED' || 
            data.type === 'QCOL_APP_SUBMITTED' ||
            data.type === 'QCOL_APPROVE_APP' ||
            data.type === 'QCOL_REJECT_APP' ||
            data.type === 'QCOL_SYNC_APPS') {
            setTimeout(() => fullSync(), 500);
        }
    });

    // ──────────────────────────────────────────────────────────
    // 8. SINCRONIZACIÓN PERIÓDICA (cada 30 segundos)
    // ──────────────────────────────────────────────────────────

    setInterval(() => {
        if (!isSyncing) {
            fullSync();
        }
    }, 30000);

    // ──────────────────────────────────────────────────────────
    // 9. FUNCIONES EXPUESTAS PARA ADMIN
    // ──────────────────────────────────────────────────────────

    // Publicar app (Admin/Founder)
    window.publishApp = function(appId) {
        const pending = safeParse('qcol_pending_quantum_apps', []);
        const published = safeParse('qcol_published_quantum_apps', []);
        
        const idx = pending.findIndex(p => p.id === appId);
        if (idx === -1) {
            console.warn('[QCOL Cloud] ⚠️ App no encontrada en pendientes');
            return false;
        }
        
        const app = pending[idx];
        
        if (published.find(p => p.id === appId)) {
            console.warn('[QCOL Cloud] ⚠️ App ya está publicada');
            return false;
        }
        
        published.push({
            ...app,
            status: 'published',
            publishedAt: new Date().toISOString()
        });
        
        pending.splice(idx, 1);
        
        localStorage.setItem('qcol_published_quantum_apps', JSON.stringify(published));
        localStorage.setItem('qcol_pending_quantum_apps', JSON.stringify(pending));
        
        console.log('[QCOL Cloud] ✅ App publicada:', app.name);
        fullSync();
        return true;
    };

    // Rechazar app (Admin/Founder)
    window.rejectApp = function(appId) {
        const pending = safeParse('qcol_pending_quantum_apps', []);
        
        const idx = pending.findIndex(p => p.id === appId);
        if (idx === -1) {
            console.warn('[QCOL Cloud] ⚠️ App no encontrada en pendientes');
            return false;
        }
        
        const app = pending[idx];
        pending.splice(idx, 1);
        localStorage.setItem('qcol_pending_quantum_apps', JSON.stringify(pending));
        
        console.log('[QCOL Cloud] 🗑️ App rechazada:', app.name);
        fullSync();
        return true;
    };

    // Subir app a pendientes (Usuario)
    window.submitAppToPending = function(appId) {
        const studio = safeParse('quantum_apps_repo_v2', []);
        const pending = safeParse('qcol_pending_quantum_apps', []);
        const published = safeParse('qcol_published_quantum_apps', []);
        
        const app = studio.find(a => a.id === appId);
        if (!app) {
            console.warn('[QCOL Cloud] ⚠️ App no encontrada en Studio');
            return false;
        }
        
        if (pending.find(p => p.id === appId)) {
            console.warn('[QCOL Cloud] ⚠️ App ya está en pendientes');
            return false;
        }
        
        if (published.find(p => p.id === appId)) {
            console.warn('[QCOL Cloud] ⚠️ App ya está publicada');
            return false;
        }
        
        pending.push({
            ...app,
            status: 'pending',
            submittedAt: new Date().toISOString()
        });
        
        localStorage.setItem('qcol_pending_quantum_apps', JSON.stringify(pending));
        
        console.log('[QCOL Cloud] 📤 App enviada a pendientes:', app.name);
        fullSync();
        return true;
    };

    // ──────────────────────────────────────────────────────────
    // 10. INICIALIZACIÓN
    // ──────────────────────────────────────────────────────────

    async function init() {
        console.log('[QCOL Cloud] 🚀 Inicializando sincronización multi-dispositivo...');
        console.log('[QCOL Cloud] 📋 Sincronizando: Studio, Pendientes, Publicadas, Proyectos, Biblioteca, Configuración');

        const config = getGitHubConfig();
        if (!config.token) {
            console.warn('[QCOL Cloud] ⚠️ Token de GitHub no configurado.');
            console.warn('[QCOL Cloud] 💡 Ve al Panel Fundador → GitHub y configura tu token.');
            console.warn('[QCOL Cloud] 💡 Sin token, la sincronización multi-dispositivo NO funcionará.');
        } else {
            console.log('[QCOL Cloud] ✅ GitHub configurado:', config.owner + '/' + config.repo);
        }

        // Primera sincronización
        await fullSync();

        console.log('[QCOL Cloud] ✅ Sincronización activa');
        console.log('[QCOL Cloud] 📊 Estado:');
        console.log(`[QCOL Cloud]   - Studio: ${safeParse('quantum_apps_repo_v2', []).length} apps`);
        console.log(`[QCOL Cloud]   - Pendientes: ${safeParse('qcol_pending_quantum_apps', []).length} apps`);
        console.log(`[QCOL Cloud]   - Publicadas: ${safeParse('qcol_published_quantum_apps', []).length} apps`);
        console.log('[QCOL Cloud] 📋 Funciones: window.publishApp(id), window.rejectApp(id), window.submitAppToPending(id)');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Exponer funciones para depuración
    window.__QCOL_CLOUD = {
        sync: fullSync,
        upload: uploadToGitHub,
        download: downloadFromGitHub,
        publishApp: window.publishApp,
        rejectApp: window.rejectApp,
        submitApp: window.submitAppToPending,
        status: () => {
            const config = getGitHubConfig();
            return {
                connected: !!config.token,
                github: config.owner + '/' + config.repo,
                hasToken: !!config.token,
                studio: safeParse('quantum_apps_repo_v2', []).length,
                pending: safeParse('qcol_pending_quantum_apps', []).length,
                published: safeParse('qcol_published_quantum_apps', []).length,
                lastSync: localStorage.getItem('_qcol_cloud_timestamp'),
                pendingList: safeParse('qcol_pending_quantum_apps', []).map(a => ({ id: a.id, name: a.name })),
                publishedList: safeParse('qcol_published_quantum_apps', []).map(a => ({ id: a.id, name: a.name }))
            };
        },
        config: getGitHubConfig
    };

})();