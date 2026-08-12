// ============================================================
//  QCOL Cloud Sync — Sincronización con GitHub
//  Versión 4.0 — FLUJO COMPLETO DE PUBLICACIÓN DE APPS
//  (c) 2026 QCOL Ecosystem
// ============================================================
(function() {
    'use strict';

    // ──────────────────────────────────────────────────────────
    // 1. CONFIGURACIÓN
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

    // ═══ CLAVES PÚBLICAS QUE SE SINCRONIZAN ═══
    const PUBLIC_KEYS = [
        'qcol_projs',
        'qcol_library',
        'qcol_published_quantum_apps',    // Apps aprobadas (visibles para todos)
        'qcol_pending_quantum_apps',      // Apps pendientes de aprobación
        'quantum_apps_repo_v2',           // Apps locales del usuario (Studio)
        'qcol_colab_url',
        'qcol_ai',
        'qcol_gh',
        'qcol_cfg',
        'qcol_sys',
        'qcol_monitor_cfg',
        'qcol_fp'
    ];

    // ──────────────────────────────────────────────────────────
    // 2. ESTADO INTERNO
    // ──────────────────────────────────────────────────────────

    let isSyncing = false;
    let lastSyncTimestamp = null;
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

    function extractPublicData() {
        return {
            projects: safeParse('qcol_projs', []),
            library: safeParse('qcol_library', []),
            puzzle: safeParse('qcol_published_quantum_apps', []),    // APROBADAS
            pending: safeParse('qcol_pending_quantum_apps', []),     // PENDIENTES
            quantum_apps: safeParse('quantum_apps_repo_v2', []),     // LOCALES (Studio)
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
            version: '4.0.0'
        };
    }

    // ═══ OBTENER USUARIO ACTUAL ═══
    function getCurrentUser() {
        try {
            const saved = localStorage.getItem('qcol_cur_user');
            return saved ? JSON.parse(saved) : null;
        } catch(e) {
            return null;
        }
    }

    // ═══ Sincroniza apps locales con pendientes/publicadas ═══
    function syncAppsBetweenKeys() {
        try {
            const studioApps = safeParse('quantum_apps_repo_v2', []);
            let publishedApps = safeParse('qcol_published_quantum_apps', []);
            let pendingApps = safeParse('qcol_pending_quantum_apps', []);
            
            const publishedMap = {};
            publishedApps.forEach(app => { publishedMap[app.id] = app; });
            
            const pendingMap = {};
            pendingApps.forEach(app => { pendingMap[app.id] = app; });
            
            let updated = false;
            
            // Para cada app del Studio, verificar si ya está en pendientes o publicadas
            studioApps.forEach(app => {
                // Si ya está publicada, no hacer nada
                if (publishedMap[app.id]) return;
                
                // Si ya está pendiente, actualizar solo si cambió
                if (pendingMap[app.id]) {
                    const existing = pendingMap[app.id];
                    if (JSON.stringify(existing) !== JSON.stringify(app)) {
                        const idx = pendingApps.findIndex(p => p.id === app.id);
                        if (idx >= 0) {
                            pendingApps[idx] = { ...app, status: 'pending', updated: new Date().toISOString() };
                            updated = true;
                        }
                    }
                    return;
                }
                
                // Nueva app: agregar a pendientes (solo si tiene nombre y código)
                if (app.name && (app.pythonCode || app.htmlCode)) {
                    pendingApps.push({
                        ...app,
                        status: 'pending',
                        submittedBy: getCurrentUser()?.username || 'anonymous',
                        submittedAt: new Date().toISOString()
                    });
                    updated = true;
                }
            });
            
            if (updated) {
                localStorage.setItem('qcol_pending_quantum_apps', JSON.stringify(pendingApps));
                console.log('[QCOL Cloud] 📋 Apps pendientes actualizadas:', pendingApps.length);
            }
            
            return updated;
        } catch(e) {
            console.warn('[QCOL Cloud] ⚠️ Error sincronizando apps:', e.message);
            return false;
        }
    }

    // ═══ PUBLICAR APP (Admin/Founder) ═══
    window.publishApp = function(appId) {
        const pendingApps = safeParse('qcol_pending_quantum_apps', []);
        const publishedApps = safeParse('qcol_published_quantum_apps', []);
        
        const idx = pendingApps.findIndex(p => p.id === appId);
        if (idx === -1) {
            console.warn('[QCOL Cloud] ⚠️ App no encontrada en pendientes');
            return false;
        }
        
        const app = pendingApps[idx];
        
        // Verificar que no esté ya publicada
        if (publishedApps.find(p => p.id === appId)) {
            console.warn('[QCOL Cloud] ⚠️ App ya está publicada');
            return false;
        }
        
        // Mover a publicadas
        publishedApps.push({
            ...app,
            status: 'published',
            publishedAt: new Date().toISOString(),
            publishedBy: getCurrentUser()?.username || 'admin'
        });
        
        // Eliminar de pendientes
        pendingApps.splice(idx, 1);
        
        localStorage.setItem('qcol_published_quantum_apps', JSON.stringify(publishedApps));
        localStorage.setItem('qcol_pending_quantum_apps', JSON.stringify(pendingApps));
        
        console.log('[QCOL Cloud] ✅ App publicada:', app.name);
        
        // Notificar y sincronizar
        window.dispatchEvent(new CustomEvent('qcol-apps-updated'));
        scheduleSync();
        
        return true;
    };

    // ═══ RECHAZAR APP (Admin/Founder) ═══
    window.rejectApp = function(appId) {
        const pendingApps = safeParse('qcol_pending_quantum_apps', []);
        
        const idx = pendingApps.findIndex(p => p.id === appId);
        if (idx === -1) {
            console.warn('[QCOL Cloud] ⚠️ App no encontrada en pendientes');
            return false;
        }
        
        // Eliminar de pendientes
        pendingApps.splice(idx, 1);
        localStorage.setItem('qcol_pending_quantum_apps', JSON.stringify(pendingApps));
        
        console.log('[QCOL Cloud] 🗑️ App rechazada:', appId);
        window.dispatchEvent(new CustomEvent('qcol-apps-updated'));
        scheduleSync();
        
        return true;
    };

    // ═══ SUBIR APP MANUALMENTE A PENDIENTES ═══
    window.submitAppToPending = function(appId) {
        const studioApps = safeParse('quantum_apps_repo_v2', []);
        const pendingApps = safeParse('qcol_pending_quantum_apps', []);
        const publishedApps = safeParse('qcol_published_quantum_apps', []);
        
        const app = studioApps.find(a => a.id === appId);
        if (!app) {
            console.warn('[QCOL Cloud] ⚠️ App no encontrada en Studio');
            return false;
        }
        
        // Verificar si ya está pendiente o publicada
        if (pendingApps.find(p => p.id === appId)) {
            console.warn('[QCOL Cloud] ⚠️ App ya está en pendientes');
            return false;
        }
        
        if (publishedApps.find(p => p.id === appId)) {
            console.warn('[QCOL Cloud] ⚠️ App ya está publicada');
            return false;
        }
        
        pendingApps.push({
            ...app,
            status: 'pending',
            submittedBy: getCurrentUser()?.username || 'anonymous',
            submittedAt: new Date().toISOString()
        });
        
        localStorage.setItem('qcol_pending_quantum_apps', JSON.stringify(pendingApps));
        
        console.log('[QCOL Cloud] 📤 App enviada a pendientes:', app.name);
        window.dispatchEvent(new CustomEvent('qcol-apps-updated'));
        scheduleSync();
        
        return true;
    };

    function applyCloudData(cloudData) {
        if (!cloudData) return false;

        let updated = false;
        const localTimestamp = localStorage.getItem('_qcol_cloud_timestamp') || '1970-01-01T00:00:00.000Z';
        
        if (cloudData.timestamp && cloudData.timestamp <= localTimestamp) {
            return false;
        }

        // ═══ Sincronizar TODAS las claves ═══
        const mappings = {
            'qcol_projs': cloudData.projects,
            'qcol_library': cloudData.library,
            'qcol_published_quantum_apps': cloudData.puzzle,
            'qcol_pending_quantum_apps': cloudData.pending,
            'quantum_apps_repo_v2': cloudData.quantum_apps
        };

        for (const [key, value] of Object.entries(mappings)) {
            if (value !== undefined) {
                const current = safeParse(key, null);
                if (JSON.stringify(current) !== JSON.stringify(value)) {
                    localStorage.setItem(key, JSON.stringify(value));
                    updated = true;
                }
            }
        }

        // ═══ Sincronizar apps ═══
        if (cloudData.quantum_apps !== undefined || cloudData.puzzle !== undefined || cloudData.pending !== undefined) {
            const syncResult = syncAppsBetweenKeys();
            if (syncResult) updated = true;
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
            console.log('[QCOL Cloud] ✅ Datos actualizados desde la nube (GitHub)');
        }

        return updated;
    }

    // ──────────────────────────────────────────────────────────
    // 4. FUNCIONES DE SINCRONIZACIÓN CON GITHUB
    // ──────────────────────────────────────────────────────────

    function getApiUrl(config) {
        return `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${config.path}`;
    }

    async function uploadToGitHub(data) {
        const config = getGitHubConfig();
        
        if (!config.token) {
            console.warn('[QCOL Cloud] ⚠️ Token de GitHub no configurado.');
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
                console.log('[QCOL Cloud] ℹ️ Archivo no existe en GitHub. Se creará en la primera subida.');
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
            // 1. Sincronizar apps localmente
            syncAppsBetweenKeys();
            
            // 2. Descargar datos de GitHub
            await downloadFromGitHub();
            
            // 3. Sincronizar apps localmente (después de descargar)
            syncAppsBetweenKeys();
            
            // 4. Subir cambios locales
            const data = extractPublicData();
            await uploadToGitHub(data);
            
            console.log('[QCOL Cloud] ✅ Sincronización completa');
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

        if (PUBLIC_KEYS.includes(key)) {
            scheduleSync();
        }
        
        if (key === 'quantum_apps_repo_v2') {
            setTimeout(() => {
                syncAppsBetweenKeys();
                window.dispatchEvent(new CustomEvent('qcol-apps-updated'));
            }, 100);
        }
    };

    function scheduleSync() {
        if (syncTimeout) clearTimeout(syncTimeout);
        syncTimeout = setTimeout(() => {
            fullSync();
            syncTimeout = null;
        }, 2000);
    }

    // ──────────────────────────────────────────────────────────
    // 7. ESCUCHAR EVENTOS DE LOS MÓDULOS
    // ──────────────────────────────────────────────────────────

    window.addEventListener('message', function(e) {
        const data = e.data;
        if (!data || typeof data !== 'object') return;
        
        if (data.type === 'QCOL_SYNC_APPS' || data.type === 'QCOL_APP_SAVED' || 
            data.type === 'QCOL_APP_PUBLISHED' || data.type === 'QCOL_APP_SUBMITTED') {
            setTimeout(() => {
                syncAppsBetweenKeys();
                fullSync();
            }, 500);
        }
        
        // Publicar app (Admin/Founder)
        if (data.type === 'QCOL_APPROVE_APP' && data.appId) {
            window.publishApp(data.appId);
        }
        
        // Rechazar app (Admin/Founder)
        if (data.type === 'QCOL_REJECT_APP' && data.appId) {
            window.rejectApp(data.appId);
        }
        
        // Subir app a pendientes (Usuario)
        if (data.type === 'QCOL_SUBMIT_APP' && data.appId) {
            window.submitAppToPending(data.appId);
        }
    });

    // ──────────────────────────────────────────────────────────
    // 8. SINCRONIZACIÓN PERIÓDICA
    // ──────────────────────────────────────────────────────────

    setInterval(() => {
        if (!isSyncing) {
            syncAppsBetweenKeys();
            downloadFromGitHub().then(() => {
                const data = extractPublicData();
                uploadToGitHub(data);
            });
        }
    }, 30000);

    // ──────────────────────────────────────────────────────────
    // 9. INICIALIZACIÓN
    // ──────────────────────────────────────────────────────────

    async function init() {
        console.log('[QCOL Cloud] 🚀 Inicializando sincronización con GitHub...');
        console.log('[QCOL Cloud] 📋 Flujo de publicación de apps activado');

        const config = getGitHubConfig();
        if (!config.token) {
            console.warn('[QCOL Cloud] ⚠️ Token de GitHub no configurado.');
            console.warn('[QCOL Cloud] 💡 Ve al Panel Fundador → GitHub y configura tu token.');
        } else {
            console.log('[QCOL Cloud] ✅ GitHub configurado:', config.owner + '/' + config.repo);
        }

        syncAppsBetweenKeys();
        await downloadFromGitHub();
        syncAppsBetweenKeys();

        const data = extractPublicData();
        await uploadToGitHub(data);

        window.addEventListener('qcol-apps-updated', function() {
            scheduleSync();
        });

        console.log('[QCOL Cloud] ✅ Sincronización con GitHub activa');
        console.log('[QCOL Cloud] 📊 Funciones disponibles:');
        console.log('[QCOL Cloud]   - window.submitAppToPending(id)  → Enviar app a pendientes');
        console.log('[QCOL Cloud]   - window.publishApp(id)          → Publicar app (Admin)');
        console.log('[QCOL Cloud]   - window.rejectApp(id)           → Rechazar app (Admin)');
        
        // Notificar al usuario
        setTimeout(() => {
            if (config.token) {
                console.log('[QCOL Cloud] ✅ Sincronización multi-dispositivo ACTIVADA');
                console.log('[QCOL Cloud] 📋 Pendientes:', safeParse('qcol_pending_quantum_apps', []).length);
                console.log('[QCOL Cloud] 📋 Publicadas:', safeParse('qcol_published_quantum_apps', []).length);
            } else {
                console.log('[QCOL Cloud] ⚠️ Configura el token de GitHub para sincronización multi-dispositivo');
            }
        }, 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Exponer funciones
    window.__QCOL_CLOUD = {
        sync: fullSync,
        upload: uploadToGitHub,
        download: downloadFromGitHub,
        syncApps: syncAppsBetweenKeys,
        publishApp: window.publishApp,
        rejectApp: window.rejectApp,
        submitApp: window.submitAppToPending,
        status: () => {
            const config = getGitHubConfig();
            const pending = safeParse('qcol_pending_quantum_apps', []);
            const published = safeParse('qcol_published_quantum_apps', []);
            const studio = safeParse('quantum_apps_repo_v2', []);
            return {
                connected: !!config.token,
                lastSync: localStorage.getItem('_qcol_cloud_timestamp'),
                github: config.owner + '/' + config.repo,
                hasToken: !!config.token,
                studioApps: studio.length,
                pendingApps: pending.length,
                publishedApps: published.length,
                pending: pending.map(a => ({ id: a.id, name: a.name, submittedBy: a.submittedBy })),
                published: published.map(a => ({ id: a.id, name: a.name, publishedAt: a.publishedAt }))
            };
        },
        config: getGitHubConfig
    };

})();