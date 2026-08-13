// ============================================================
//  QCOL Cloud Sync — Sincronización con GitHub
//  Versión 7.0 — MERGE COMPLETO DE APPS (CON TODO EL CÓDIGO)
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

    // ═══ FUNCIÓN DE MERGE (UNIÓN DE CONJUNTOS) - COMPARACIÓN PROFUNDA ═══
    function mergeArraysDeep(localArray, cloudArray) {
        // Crear un mapa con los elementos locales (por id + contenido)
        const mergedMap = {};
        
        // Primero agregar todos los locales
        if (Array.isArray(localArray)) {
            localArray.forEach(item => {
                if (item && item.id) {
                    // Guardar el item completo, no solo el id
                    mergedMap[item.id] = item;
                }
            });
        }
        
        // Luego agregar los de la nube (sobrescriben si existe, agregan si no)
        if (Array.isArray(cloudArray)) {
            cloudArray.forEach(item => {
                if (item && item.id) {
                    // Si ya existe en local, verificar si el contenido es diferente
                    if (mergedMap[item.id]) {
                        // Si el contenido es diferente, fusionar (priorizar el más completo)
                        const localItem = mergedMap[item.id];
                        const cloudItem = item;
                        
                        // Fusionar objetos profundamente (mantener todas las propiedades)
                        mergedMap[item.id] = deepMerge(localItem, cloudItem);
                    } else {
                        // Si no existe, agregar completo
                        mergedMap[item.id] = item;
                    }
                }
            });
        }
        
        // Convertir de vuelta a array y limpiar duplicados por contenido
        const result = Object.values(mergedMap);
        
        // Eliminar duplicados exactos (mismo contenido)
        const seen = new Set();
        return result.filter(item => {
            const key = JSON.stringify(item);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    // ═══ FUSIÓN PROFUNDA DE OBJETOS ═══
    function deepMerge(obj1, obj2) {
        const result = { ...obj1 };
        
        for (const key in obj2) {
            if (obj2.hasOwnProperty(key)) {
                // Si ambos son objetos, fusionar recursivamente
                if (obj2[key] && typeof obj2[key] === 'object' && !Array.isArray(obj2[key]) && obj1[key]) {
                    result[key] = deepMerge(obj1[key], obj2[key]);
                } else {
                    // Si es un valor simple o array, sobrescribir con el de la nube (más reciente)
                    result[key] = obj2[key];
                }
            }
        }
        
        return result;
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
            version: '7.0.0'
        };
    }

    function getCurrentUser() {
        try {
            const saved = localStorage.getItem('qcol_cur_user');
            return saved ? JSON.parse(saved) : null;
        } catch(e) {
            return null;
        }
    }

    // ═══ MERGE ENTRE STUDIO, PENDIENTES Y PUBLICADAS (CON CONTENIDO COMPLETO) ═══
    function syncAppsBetweenKeys() {
        try {
            // Leer todas las listas
            let studioApps = safeParse('quantum_apps_repo_v2', []);
            let publishedApps = safeParse('qcol_published_quantum_apps', []);
            let pendingApps = safeParse('qcol_pending_quantum_apps', []);
            
            console.log('[QCOL Cloud] 📊 ANTES DEL MERGE:');
            console.log('[QCOL Cloud]   Studio:', studioApps.length);
            console.log('[QCOL Cloud]   Pendientes:', pendingApps.length);
            console.log('[QCOL Cloud]   Publicadas:', publishedApps.length);
            
            // 🔄 MERGE PROFUNDO: Unir Studio con Pendientes (con todo el contenido)
            const mergedPending = mergeArraysDeep(pendingApps, studioApps);
            
            // 🔄 MERGE PROFUNDO: Unir Pendientes con Publicadas (con todo el contenido)
            const mergedPublished = mergeArraysDeep(publishedApps, mergedPending);
            
            // Las apps que están en Studio pero no en Pendientes ni Publicadas
            const studioIds = new Set(studioApps.map(a => a.id));
            const pendingIds = new Set(mergedPending.map(a => a.id));
            const publishedIds = new Set(mergedPublished.map(a => a.id));
            
            // Apps que están en Studio pero no en ningún otro lado → agregar a pendientes
            const newApps = studioApps.filter(a => !pendingIds.has(a.id) && !publishedIds.has(a.id));
            
            if (newApps.length > 0) {
                console.log('[QCOL Cloud] 📱 Nuevas apps del Studio encontradas:', newApps.length);
                newApps.forEach(app => {
                    if (app.name && (app.pythonCode || app.htmlCode)) {
                        mergedPending.push({
                            ...app, // TODO EL CONTENIDO COMPLETO
                            status: 'pending',
                            submittedBy: getCurrentUser()?.username || 'anonymous',
                            submittedAt: new Date().toISOString()
                        });
                    }
                });
            }
            
            // 🔄 MERGE FINAL: Unir todo de nuevo para asegurar que no se pierda nada
            const finalPending = mergeArraysDeep(mergedPending, mergedPublished);
            const finalPublished = mergeArraysDeep(mergedPublished, mergedPending);
            
            // Guardar solo si hay cambios
            const currentPending = safeParse('qcol_pending_quantum_apps', []);
            const currentPublished = safeParse('qcol_published_quantum_apps', []);
            
            if (JSON.stringify(finalPending) !== JSON.stringify(currentPending)) {
                localStorage.setItem('qcol_pending_quantum_apps', JSON.stringify(finalPending));
                console.log('[QCOL Cloud] 📋 Pendientes actualizadas (MERGE):', finalPending.length);
            }
            
            if (JSON.stringify(finalPublished) !== JSON.stringify(currentPublished)) {
                localStorage.setItem('qcol_published_quantum_apps', JSON.stringify(finalPublished));
                console.log('[QCOL Cloud] 📋 Publicadas actualizadas (MERGE):', finalPublished.length);
            }
            
            console.log('[QCOL Cloud] 📊 DESPUÉS DEL MERGE:');
            console.log('[QCOL Cloud]   Pendientes:', finalPending.length);
            console.log('[QCOL Cloud]   Publicadas:', finalPublished.length);
            
            return true;
        } catch(e) {
            console.warn('[QCOL Cloud] ⚠️ Error en MERGE de apps:', e.message);
            return false;
        }
    }

    // ═══ MERGE CON DATOS DE LA NUBE (CON CONTENIDO COMPLETO) ═══
    function applyCloudData(cloudData) {
        if (!cloudData) return false;

        let updated = false;

        // ═══ MERGE PROFUNDO: Unir datos locales con datos de la nube ═══
        const mergeMappings = {
            'qcol_projs': cloudData.projects,
            'qcol_library': cloudData.library,
            'qcol_published_quantum_apps': cloudData.puzzle,
            'qcol_pending_quantum_apps': cloudData.pending,
            'quantum_apps_repo_v2': cloudData.quantum_apps
        };

        for (const [key, cloudValue] of Object.entries(mergeMappings)) {
            if (cloudValue !== undefined) {
                const localValue = safeParse(key, []);
                // 🔄 MERGE PROFUNDO: Unir local + nube (con todo el contenido)
                const merged = mergeArraysDeep(localValue, cloudValue);
                
                if (JSON.stringify(merged) !== JSON.stringify(localValue)) {
                    localStorage.setItem(key, JSON.stringify(merged));
                    updated = true;
                    console.log('[QCOL Cloud] 🔄 MERGE completado para:', key, '→', merged.length, 'elementos');
                    
                    // Mostrar los nombres de las apps para verificar
                    if (key === 'qcol_pending_quantum_apps' || key === 'qcol_published_quantum_apps') {
                        const names = merged.map(a => a.name || a.id).join(', ');
                        console.log('[QCOL Cloud]   📱 Apps en', key, ':', names);
                    }
                }
            }
        }

        // Configuración (siempre toma la más reciente)
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

        if (updated) {
            console.log('[QCOL Cloud] ✅ MERGE completado con datos de la nube');
        }

        return updated;
    }

    // ═══ PUBLICAR APP (Admin/Founder) ═══
    window.publishApp = function(appId) {
        let pendingApps = safeParse('qcol_pending_quantum_apps', []);
        let publishedApps = safeParse('qcol_published_quantum_apps', []);
        
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
        
        // Mover a publicadas (con todo el contenido)
        publishedApps.push({
            ...app, // TODO EL CONTENIDO COMPLETO
            status: 'published',
            publishedAt: new Date().toISOString(),
            publishedBy: getCurrentUser()?.username || 'admin'
        });
        
        // Eliminar de pendientes
        pendingApps.splice(idx, 1);
        
        localStorage.setItem('qcol_published_quantum_apps', JSON.stringify(publishedApps));
        localStorage.setItem('qcol_pending_quantum_apps', JSON.stringify(pendingApps));
        
        console.log('[QCOL Cloud] ✅ App publicada:', app.name);
        console.log('[QCOL Cloud]   📄 Contenido:', {
            id: app.id,
            name: app.name,
            pythonCode: app.pythonCode ? '✅' : '❌',
            htmlCode: app.htmlCode ? '✅' : '❌'
        });
        window.dispatchEvent(new CustomEvent('qcol-apps-updated'));
        scheduleSync();
        
        return true;
    };

    // ═══ RECHAZAR APP (Admin/Founder) ═══
    window.rejectApp = function(appId) {
        let pendingApps = safeParse('qcol_pending_quantum_apps', []);
        
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

    // ═══ SUBIR APP MANUALMENTE A PENDIENTES ═══
    window.submitAppToPending = function(appId) {
        const studioApps = safeParse('quantum_apps_repo_v2', []);
        let pendingApps = safeParse('qcol_pending_quantum_apps', []);
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
            ...app, // TODO EL CONTENIDO COMPLETO
            status: 'pending',
            submittedBy: getCurrentUser()?.username || 'anonymous',
            submittedAt: new Date().toISOString()
        });
        
        localStorage.setItem('qcol_pending_quantum_apps', JSON.stringify(pendingApps));
        
        console.log('[QCOL Cloud] 📤 App enviada a pendientes:', app.name);
        console.log('[QCOL Cloud]   📄 Contenido:', {
            id: app.id,
            name: app.name,
            pythonCode: app.pythonCode ? '✅' : '❌',
            htmlCode: app.htmlCode ? '✅' : '❌'
        });
        window.dispatchEvent(new CustomEvent('qcol-apps-updated'));
        scheduleSync();
        
        return true;
    };

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

            // 🔄 Aplicar MERGE con datos de la nube
            const updated = applyCloudData(data);
            if (updated) {
                console.log('[QCOL Cloud] ✅ MERGE completado con datos de GitHub');
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
            console.log('[QCOL Cloud] 🔄 Iniciando sincronización completa (MERGE)...');
            
            // 1. Sincronizar apps localmente (MERGE)
            syncAppsBetweenKeys();
            
            // 2. Descargar datos de GitHub y hacer MERGE
            await downloadFromGitHub();
            
            // 3. Sincronizar apps localmente (MERGE) después de descargar
            syncAppsBetweenKeys();
            
            // 4. Subir datos fusionados a GitHub
            const data = extractPublicData();
            await uploadToGitHub(data);
            
            console.log('[QCOL Cloud] ✅ Sincronización completa (MERGE)');
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
                syncAppsBetweenKeys();
                const data = extractPublicData();
                uploadToGitHub(data);
            });
        }
    }, 30000);

    // ──────────────────────────────────────────────────────────
    // 9. INICIALIZACIÓN
    // ──────────────────────────────────────────────────────────

    async function init() {
        console.log('[QCOL Cloud] 🚀 Inicializando sincronización con MERGE de apps completas...');
        console.log('[QCOL Cloud] 📋 Claves sincronizadas:', PUBLIC_KEYS);

        const config = getGitHubConfig();
        if (!config.token) {
            console.warn('[QCOL Cloud] ⚠️ Token de GitHub no configurado.');
            console.warn('[QCOL Cloud] 💡 Ve al Panel Fundador → GitHub y configura tu token.');
        } else {
            console.log('[QCOL Cloud] ✅ GitHub configurado:', config.owner + '/' + config.repo);
        }

        // 🔄 MERGE inicial
        syncAppsBetweenKeys();
        
        // 🔄 Descargar y hacer MERGE con GitHub
        await downloadFromGitHub();
        
        // 🔄 MERGE después de descargar
        syncAppsBetweenKeys();

        // 🔄 Subir datos fusionados
        const data = extractPublicData();
        await uploadToGitHub(data);

        window.addEventListener('qcol-apps-updated', function() {
            scheduleSync();
        });

        console.log('[QCOL Cloud] ✅ Sincronización con MERGE activa');
        
        setTimeout(() => {
            const pending = safeParse('qcol_pending_quantum_apps', []);
            const published = safeParse('qcol_published_quantum_apps', []);
            const studio = safeParse('quantum_apps_repo_v2', []);
            console.log('[QCOL Cloud] 📊 Studio:', studio.length);
            console.log('[QCOL Cloud] 📊 Pendientes:', pending.length);
            console.log('[QCOL Cloud] 📊 Publicadas:', published.length);
            
            // Mostrar nombres de las apps
            if (pending.length > 0) {
                console.log('[QCOL Cloud] 📱 Apps pendientes:', pending.map(a => a.name || a.id).join(', '));
            }
            if (published.length > 0) {
                console.log('[QCOL Cloud] 📱 Apps publicadas:', published.map(a => a.name || a.id).join(', '));
            }
            
            if (config.token) {
                console.log('[QCOL Cloud] ✅ Sincronización multi-dispositivo ACTIVADA (MERGE completo)');
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
        merge: mergeArraysDeep,
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
                pending: pending.map(a => ({ 
                    id: a.id, 
                    name: a.name, 
                    submittedBy: a.submittedBy,
                    hasPython: !!a.pythonCode,
                    hasHTML: !!a.htmlCode
                })),
                published: published.map(a => ({ 
                    id: a.id, 
                    name: a.name,
                    hasPython: !!a.pythonCode,
                    hasHTML: !!a.htmlCode
                }))
            };
        },
        config: getGitHubConfig
    };

})();