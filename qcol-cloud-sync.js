// ============================================================
//  QCOL Cloud Sync — Sincronización con GitHub (UNIÓN)
//  Versión 6.0 — FUSIÓN DE DATOS (UNIÓN DE CONJUNTOS)
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
        'qcol_published_quantum_apps',
        'qcol_pending_quantum_apps',
        'quantum_apps_repo_v2',
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

    function getCurrentUser() {
        try {
            const saved = localStorage.getItem('qcol_cur_user');
            return saved ? JSON.parse(saved) : null;
        } catch(e) {
            return null;
        }
    }

    // ═══ FUNCIÓN DE UNIÓN (MERGE) ═══
    function mergeArrays(localArray, cloudArray, idField = 'id') {
        // Crear un mapa con todos los elementos locales
        const mergedMap = {};
        
        // Primero, agregar todos los elementos locales
        localArray.forEach(item => {
            if (item && item[idField]) {
                mergedMap[item[idField]] = { ...item };
            }
        });
        
        // Luego, agregar o actualizar con elementos de la nube
        cloudArray.forEach(item => {
            if (item && item[idField]) {
                if (mergedMap[item[idField]]) {
                    // Si existe localmente, conservar la versión más reciente
                    // (usar timestamp si existe)
                    const localItem = mergedMap[item[idField]];
                    const localTime = localItem.updatedAt || localItem.timestamp || localItem.submittedAt || '';
                    const cloudTime = item.updatedAt || item.timestamp || item.submittedAt || '';
                    
                    // Si la nube es más reciente, actualizar
                    if (cloudTime > localTime) {
                        mergedMap[item[idField]] = { ...item };
                    }
                    // Si local es más reciente, mantener local
                } else {
                    // No existe localmente, agregar desde la nube
                    mergedMap[item[idField]] = { ...item };
                }
            }
        });
        
        // Convertir el mapa de vuelta a array
        return Object.values(mergedMap);
    }

    // ═══ FUNCIÓN DE UNIÓN PARA CONFIGURACIÓN ═══
    function mergeConfig(localConfig, cloudConfig) {
        const merged = { ...localConfig };
        
        for (const [key, value] of Object.entries(cloudConfig)) {
            if (value !== undefined && value !== null && value !== '') {
                // Si es un objeto, fusionar recursivamente
                if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                    if (typeof merged[key] === 'object' && merged[key] !== null && !Array.isArray(merged[key])) {
                        merged[key] = { ...merged[key], ...value };
                    } else {
                        merged[key] = { ...value };
                    }
                } else {
                    // Si el valor local está vacío o la nube tiene algo, usar nube
                    if (!merged[key] || merged[key] === '' || merged[key] === null) {
                        merged[key] = value;
                    }
                }
            }
        }
        
        return merged;
    }

    function extractPublicData() {
        return {
            projects: safeParse('qcol_projs', []),
            library: safeParse('qcol_library', []),
            puzzle: safeParse('qcol_published_quantum_apps', []),
            pending: safeParse('qcol_pending_quantum_apps', []),
            quantum_apps: safeParse('quantum_apps_repo_v2', []),
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
            version: '6.0.0'
        };
    }

    // ═══ SINCRONIZAR APPS (UNIÓN) ═══
    function syncAppsBetweenKeys() {
        try {
            const studioApps = safeParse('quantum_apps_repo_v2', []);
            let publishedApps = safeParse('qcol_published_quantum_apps', []);
            let pendingApps = safeParse('qcol_pending_quantum_apps', []);
            
            // Crear mapas para referencia rápida
            const publishedMap = {};
            publishedApps.forEach(app => { if (app.id) publishedMap[app.id] = app; });
            
            const pendingMap = {};
            pendingApps.forEach(app => { if (app.id) pendingMap[app.id] = app; });
            
            let updated = false;
            
            // Para cada app del Studio, verificar si ya está en pendientes o publicadas
            studioApps.forEach(app => {
                if (!app.id) return;
                
                // Si ya está publicada, no hacer nada
                if (publishedMap[app.id]) return;
                
                // Si ya está pendiente, actualizar solo si cambió
                if (pendingMap[app.id]) {
                    const existing = pendingMap[app.id];
                    if (JSON.stringify(existing) !== JSON.stringify(app)) {
                        const idx = pendingApps.findIndex(p => p.id === app.id);
                        if (idx >= 0) {
                            pendingApps[idx] = { 
                                ...app, 
                                status: 'pending', 
                                updatedAt: new Date().toISOString() 
                            };
                            updated = true;
                        }
                    }
                    return;
                }
                
                // Nueva app: agregar a pendientes
                if (app.name && (app.pythonCode || app.htmlCode)) {
                    pendingApps.push({
                        ...app,
                        status: 'pending',
                        submittedBy: getCurrentUser()?.username || 'anonymous',
                        submittedAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    });
                    updated = true;
                }
            });
            
            if (updated) {
                localStorage.setItem('qcol_pending_quantum_apps', JSON.stringify(pendingApps));
                console.log('[QCOL Cloud] 📋 Apps pendientes actualizadas (unión):', pendingApps.length);
            }
            
            return updated;
        } catch(e) {
            console.warn('[QCOL Cloud] ⚠️ Error sincronizando apps:', e.message);
            return false;
        }
    }

    // ═══ FUNCIONES DE PUBLICACIÓN ═══
    window.publishApp = function(appId) {
        const pendingApps = safeParse('qcol_pending_quantum_apps', []);
        const publishedApps = safeParse('qcol_published_quantum_apps', []);
        
        const idx = pendingApps.findIndex(p => p.id === appId);
        if (idx === -1) {
            console.warn('[QCOL Cloud] ⚠️ App no encontrada en pendientes');
            return false;
        }
        
        const app = pendingApps[idx];
        
        if (publishedApps.find(p => p.id === appId)) {
            console.warn('[QCOL Cloud] ⚠️ App ya está publicada');
            return false;
        }
        
        publishedApps.push({
            ...app,
            status: 'published',
            publishedAt: new Date().toISOString(),
            publishedBy: getCurrentUser()?.username || 'admin'
        });
        
        pendingApps.splice(idx, 1);
        
        localStorage.setItem('qcol_published_quantum_apps', JSON.stringify(publishedApps));
        localStorage.setItem('qcol_pending_quantum_apps', JSON.stringify(pendingApps));
        
        console.log('[QCOL Cloud] ✅ App publicada:', app.name);
        window.dispatchEvent(new CustomEvent('qcol-apps-updated'));
        scheduleSync();
        
        return true;
    };

    window.rejectApp = function(appId) {
        const pendingApps = safeParse('qcol_pending_quantum_apps', []);
        
        const idx = pendingApps.findIndex(p => p.id === appId);
        if (idx === -1) {
            console.warn('[QCOL Cloud] ⚠️ App no encontrada en pendientes');
            return false;
        }
        
        pendingApps.splice(idx, 1);
        localStorage.setItem('qcol_pending_quantum_apps', JSON.stringify(pendingApps));
        
        console.log('[QCOL Cloud] 🗑️ App rechazada:', appId);
        window.dispatchEvent(new CustomEvent('qcol-apps-updated'));
        scheduleSync();
        
        return true;
    };

    window.submitAppToPending = function(appId) {
        const studioApps = safeParse('quantum_apps_repo_v2', []);
        const pendingApps = safeParse('qcol_pending_quantum_apps', []);
        const publishedApps = safeParse('qcol_published_quantum_apps', []);
        
        const app = studioApps.find(a => a.id === appId);
        if (!app) {
            console.warn('[QCOL Cloud] ⚠️ App no encontrada en Studio');
            return false;
        }
        
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
            submittedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        
        localStorage.setItem('qcol_pending_quantum_apps', JSON.stringify(pendingApps));
        
        console.log('[QCOL Cloud] 📤 App enviada a pendientes:', app.name);
        window.dispatchEvent(new CustomEvent('qcol-apps-updated'));
        scheduleSync();
        
        return true;
    };

    // ═══ APLICAR DATOS CON UNIÓN (MERGE) ═══
    function applyCloudData(cloudData) {
        if (!cloudData) return false;

        let updated = false;
        const localTimestamp = localStorage.getItem('_qcol_cloud_timestamp') || '1970-01-01T00:00:00.000Z';
        
        // Si la nube es más antigua, igual hacemos unión (no perdemos datos)
        // Solo usamos timestamp para decidir qué versión es más reciente para conflictos
        
        // ═══ UNIÓN DE TODAS LAS CLAVES ═══
        const mappings = {
            'qcol_projs': cloudData.projects,
            'qcol_library': cloudData.library,
            'qcol_published_quantum_apps': cloudData.puzzle,
            'qcol_pending_quantum_apps': cloudData.pending,
            'quantum_apps_repo_v2': cloudData.quantum_apps
        };

        for (const [key, value] of Object.entries(mappings)) {
            if (value !== undefined && Array.isArray(value)) {
                const local = safeParse(key, []);
                
                // ═══ UNIÓN DE ARRAYS (MERGE) ═══
                const merged = mergeArrays(local, value, 'id');
                
                // Verificar si realmente cambió
                if (JSON.stringify(local) !== JSON.stringify(merged)) {
                    localStorage.setItem(key, JSON.stringify(merged));
                    updated = true;
                    console.log(`[QCOL Cloud] 🔄 ${key}: ${local.length} → ${merged.length} (unión)`);
                }
            }
        }

        // ═══ UNIÓN DE CONFIGURACIÓN ═══
        if (cloudData.config) {
            const localConfig = {
                colab_url: localStorage.getItem('qcol_colab_url') || '',
                ai: safeParse('qcol_ai', {}),
                github: safeParse('qcol_gh', {}),
                platform: safeParse('qcol_cfg', {}),
                system: safeParse('qcol_sys', {}),
                monitor: safeParse('qcol_monitor_cfg', {}),
                founder_pass: localStorage.getItem('qcol_fp') || ''
            };
            
            const mergedConfig = mergeConfig(localConfig, cloudData.config);
            
            // Aplicar configuración fusionada
            const configMappings = {
                'qcol_colab_url': mergedConfig.colab_url,
                'qcol_ai': mergedConfig.ai,
                'qcol_gh': mergedConfig.github,
                'qcol_cfg': mergedConfig.platform,
                'qcol_sys': mergedConfig.system,
                'qcol_monitor_cfg': mergedConfig.monitor,
                'qcol_fp': mergedConfig.founder_pass
            };
            
            for (const [key, value] of Object.entries(configMappings)) {
                if (value !== undefined && value !== null) {
                    const current = localStorage.getItem(key);
                    const newValue = typeof value === 'object' ? JSON.stringify(value) : value;
                    if (current !== newValue) {
                        localStorage.setItem(key, newValue);
                        updated = true;
                    }
                }
            }
        }

        // ═══ Sincronizar apps entre claves (unión local) ═══
        if (cloudData.quantum_apps !== undefined || cloudData.puzzle !== undefined || cloudData.pending !== undefined) {
            const syncResult = syncAppsBetweenKeys();
            if (syncResult) updated = true;
        }

        if (updated && cloudData.timestamp) {
            // Solo actualizar timestamp si la nube es más reciente
            if (cloudData.timestamp > localTimestamp) {
                localStorage.setItem('_qcol_cloud_timestamp', cloudData.timestamp);
            }
            console.log('[QCOL Cloud] ✅ Datos fusionados (unión) con la nube');
        }

        return updated;
    }

    // ──────────────────────────────────────────────────────────
    // 4. GITHUB API
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

            // ═══ APLICAR UNIÓN (MERGE) ═══
            const updated = applyCloudData(data);
            if (updated) {
                console.log('[QCOL Cloud] ✅ Datos fusionados desde GitHub');
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
            
            // 2. Descargar y fusionar datos de GitHub
            await downloadFromGitHub();
            
            // 3. Sincronizar apps localmente (después de la fusión)
            syncAppsBetweenKeys();
            
            // 4. Subir datos fusionados a GitHub
            const data = extractPublicData();
            await uploadToGitHub(data);
            
            console.log('[QCOL Cloud] ✅ Sincronización completa (unión)');
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
    // 7. EVENTOS
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
        
        if (data.type === 'QCOL_APPROVE_APP' && data.appId) {
            window.publishApp(data.appId);
        }
        
        if (data.type === 'QCOL_REJECT_APP' && data.appId) {
            window.rejectApp(data.appId);
        }
        
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
        console.log('[QCOL Cloud] 🚀 Inicializando sincronización con GitHub (UNIÓN)...');
        console.log('[QCOL Cloud] 📋 Claves sincronizadas:', PUBLIC_KEYS);

        const config = getGitHubConfig();
        if (!config.token) {
            console.warn('[QCOL Cloud] ⚠️ Token de GitHub no configurado.');
            console.warn('[QCOL Cloud] 💡 Ve al Panel Fundador → GitHub y configura tu token.');
        } else {
            console.log('[QCOL Cloud] ✅ GitHub configurado:', config.owner + '/' + config.repo);
        }

        // Sincronizar apps localmente
        syncAppsBetweenKeys();
        
        // Descargar y fusionar datos de GitHub
        await downloadFromGitHub();
        
        // Sincronizar apps localmente (después de la fusión)
        syncAppsBetweenKeys();

        // Subir datos fusionados a GitHub
        const data = extractPublicData();
        await uploadToGitHub(data);

        window.addEventListener('qcol-apps-updated', function() {
            scheduleSync();
        });

        console.log('[QCOL Cloud] ✅ Sincronización con GitHub activa (UNIÓN)');
        
        setTimeout(() => {
            const pending = safeParse('qcol_pending_quantum_apps', []);
            const published = safeParse('qcol_published_quantum_apps', []);
            const studio = safeParse('quantum_apps_repo_v2', []);
            console.log('[QCOL Cloud] 📊 Studio:', studio.length);
            console.log('[QCOL Cloud] 📊 Pendientes:', pending.length);
            console.log('[QCOL Cloud] 📊 Publicadas:', published.length);
            
            if (config.token) {
                console.log('[QCOL Cloud] ✅ Sincronización multi-dispositivo ACTIVADA (UNIÓN)');
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
                published: published.map(a => ({ id: a.id, name: a.name }))
            };
        },
        config: getGitHubConfig
    };

})();