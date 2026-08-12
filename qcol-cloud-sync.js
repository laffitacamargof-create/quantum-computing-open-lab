// ============================================================
//  QCOL Cloud Sync — Sincronización con GitHub
//  Versión 3.0 — MULTIDISPOSITIVO
//  (c) 2026 QCOL Ecosystem
// ============================================================
(function() {
    'use strict';

    // ──────────────────────────────────────────────────────────
    // 1. CONFIGURACIÓN (usa GitHub como backend)
    // ──────────────────────────────────────────────────────────

    // Leer configuración de GitHub desde localStorage (configurada en Founder Panel)
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
        // Proyectos y biblioteca
        'qcol_projs',
        'qcol_library',
        
        // Apps de Quantum Puzzle
        'qcol_published_quantum_apps',
        'qcol_pending_quantum_apps',
        
        // Apps de Quantum App Studio
        'quantum_apps_repo_v2',
        
        // Configuración del ecosistema
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
    let isProcessingSync = false;
    let currentSha = null;

    // ──────────────────────────────────────────────────────────
    // 3. FUNCIONES DE LECTURA/ESCRITURA DE DATOS
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
        const data = {
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
            version: '3.0.0'
        };
        return data;
    }

    // ═══ Sincroniza apps entre Studio y Puzzle ═══
    function syncAppsBetweenKeys() {
        try {
            const studioApps = safeParse('quantum_apps_repo_v2', []);
            let publishedApps = safeParse('qcol_published_quantum_apps', []);
            
            const publishedMap = {};
            publishedApps.forEach(app => { publishedMap[app.id] = app; });
            
            let updated = false;
            studioApps.forEach(app => {
                if (!publishedMap[app.id]) {
                    publishedApps.push(app);
                    updated = true;
                } else {
                    const existing = publishedMap[app.id];
                    if (JSON.stringify(existing) !== JSON.stringify(app)) {
                        const idx = publishedApps.findIndex(p => p.id === app.id);
                        if (idx >= 0) {
                            publishedApps[idx] = app;
                            updated = true;
                        }
                    }
                }
            });
            
            if (updated) {
                localStorage.setItem('qcol_published_quantum_apps', JSON.stringify(publishedApps));
                console.log('[QCOL Cloud] 🔄 Apps sincronizadas entre Studio y Puzzle:', publishedApps.length);
            }
            return updated;
        } catch(e) {
            console.warn('[QCOL Cloud] ⚠️ Error sincronizando apps:', e.message);
            return false;
        }
    }

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

        // ═══ Sincronizar apps entre Studio y Puzzle ═══
        if (cloudData.quantum_apps !== undefined || cloudData.puzzle !== undefined) {
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
            console.warn('[QCOL Cloud] ⚠️ Token de GitHub no configurado. Usa el Panel Fundador → GitHub para configurarlo.');
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

            // Si tenemos SHA, actualizar el archivo existente
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
            
            console.log('[QCOL Cloud] ✅ Datos subidos a GitHub:', result.content.path);
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
            const headers = {
                'Accept': 'application/vnd.github.v3+json'
            };
            
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

            // Decodificar contenido
            const content = atob(result.content.replace(/\n/g, ''));
            const data = JSON.parse(content);

            // Aplicar datos
            const updated = applyCloudData(data);
            if (updated) {
                console.log('[QCOL Cloud] ✅ Datos descargados de GitHub:', result.path);
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

    const originalRemoveItem = localStorage.removeItem;
    localStorage.removeItem = function(key) {
        originalRemoveItem.call(this, key);
        if (PUBLIC_KEYS.includes(key)) {
            scheduleSync();
        }
    };

    function scheduleSync() {
        if (syncTimeout) clearTimeout(syncTimeout);
        syncTimeout = setTimeout(() => {
            fullSync();
            syncTimeout = null;
        }, 2000); // 2 segundos de debounce
    }

    // ──────────────────────────────────────────────────────────
    // 7. ESCUCHAR EVENTOS DE LOS MÓDULOS
    // ──────────────────────────────────────────────────────────

    window.addEventListener('message', function(e) {
        const data = e.data;
        if (!data || typeof data !== 'object') return;
        
        if (data.type === 'QCOL_SYNC_APPS' || data.type === 'QCOL_APP_SAVED' || data.type === 'QCOL_APP_PUBLISHED') {
            setTimeout(() => {
                syncAppsBetweenKeys();
                fullSync();
            }, 500);
        }
        
        if (data.type === 'QCOL_APP_PUBLISHED' && data.app) {
            const studioApps = safeParse('quantum_apps_repo_v2', []);
            const existing = studioApps.findIndex(a => a.id === data.app.id);
            if (existing === -1) {
                studioApps.push(data.app);
                localStorage.setItem('quantum_apps_repo_v2', JSON.stringify(studioApps));
                scheduleSync();
            }
        }
    });

    // ──────────────────────────────────────────────────────────
    // 8. SINCORNIZACIÓN PERIÓDICA
    // ──────────────────────────────────────────────────────────

    setInterval(() => {
        if (!isSyncing) {
            syncAppsBetweenKeys();
            // Verificar si hay cambios en GitHub
            downloadFromGitHub().then(() => {
                // Si hubo cambios, subir los locales también
                if (localStorage.getItem('_qcol_cloud_timestamp')) {
                    const data = extractPublicData();
                    uploadToGitHub(data);
                }
            });
        }
    }, 30000); // Cada 30 segundos

    // ──────────────────────────────────────────────────────────
    // 9. INICIALIZACIÓN
    // ──────────────────────────────────────────────────────────

    async function init() {
        console.log('[QCOL Cloud] 🚀 Inicializando sincronización con GitHub...');
        console.log('[QCOL Cloud] 📋 Claves sincronizadas:', PUBLIC_KEYS);

        // Verificar configuración de GitHub
        const config = getGitHubConfig();
        if (!config.token) {
            console.warn('[QCOL Cloud] ⚠️ Token de GitHub no configurado.');
            console.warn('[QCOL Cloud] 💡 Ve al Panel Fundador → GitHub y configura tu token.');
        } else {
            console.log('[QCOL Cloud] ✅ GitHub configurado:', config.owner + '/' + config.repo);
        }

        // Sincronizar apps localmente
        syncAppsBetweenKeys();

        // Descargar datos iniciales desde GitHub
        await downloadFromGitHub();

        // Sincronizar apps localmente (después de descargar)
        syncAppsBetweenKeys();

        // Subir datos locales a GitHub (si no existen)
        const data = extractPublicData();
        await uploadToGitHub(data);

        // Escuchar eventos de apps
        window.addEventListener('qcol-apps-updated', function() {
            scheduleSync();
        });

        console.log('[QCOL Cloud] ✅ Sincronización con GitHub activa');
        console.log('[QCOL Cloud] 📊 Apps sincronizadas entre Studio y Puzzle automáticamente');
        
        // Notificar al usuario que la sincronización está activa
        setTimeout(() => {
            if (config.token) {
                console.log('[QCOL Cloud] ✅ Sincronización multi-dispositivo ACTIVADA');
            } else {
                console.log('[QCOL Cloud] ⚠️ Configura el token de GitHub para sincronización multi-dispositivo');
            }
        }, 1000);
    }

    // Inicializar
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
        syncApps: syncAppsBetweenKeys,
        status: () => {
            const config = getGitHubConfig();
            return {
                connected: !!config.token,
                lastSync: localStorage.getItem('_qcol_cloud_timestamp'),
                github: config.owner + '/' + config.repo,
                hasToken: !!config.token,
                studioApps: safeParse('quantum_apps_repo_v2', []).length,
                puzzleApps: safeParse('qcol_published_quantum_apps', []).length,
                pendingApps: safeParse('qcol_pending_quantum_apps', []).length
            };
        },
        config: getGitHubConfig
    };

})();