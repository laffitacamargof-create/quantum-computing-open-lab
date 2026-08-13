// ============================================================
//  qcol-cloud-sync.js — VERSIÓN SIMPLE Y FUNCIONAL
//  SOLO SINCRONIZA, NUNCA BORRA
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

    // ──────────────────────────────────────────────────────────
    // 2. CLAVES A SINCRONIZAR
    // ──────────────────────────────────────────────────────────

    const SYNC_KEYS = [
        'qcol_published_quantum_apps',
        'qcol_pending_quantum_apps',
        'quantum_apps_repo_v2',
        'qcol_projs',
        'qcol_library',
        'qcol_colab_url',
        'qcol_ai',
        'qcol_gh',
        'qcol_cfg',
        'qcol_sys',
        'qcol_monitor_cfg',
        'qcol_fp'
    ];

    // ──────────────────────────────────────────────────────────
    // 3. FUNCIONES BÁSICAS
    // ──────────────────────────────────────────────────────────

    function getData(key) {
        try {
            const val = localStorage.getItem(key);
            return val ? JSON.parse(val) : [];
        } catch(e) {
            return [];
        }
    }

    function setData(key, data) {
        localStorage.setItem(key, JSON.stringify(data));
    }

    // ═══ MERGE: UNIR DOS LISTAS, NUNCA BORRAR ═══
    function mergeLists(localList, cloudList) {
        // Si la nube está vacía, NO SOBRESCRIBIR
        if (!cloudList || cloudList.length === 0) {
            return localList;
        }
        
        // Si local está vacía, tomar la nube
        if (!localList || localList.length === 0) {
            return cloudList;
        }
        
        // Si ambas tienen datos, UNIR
        const merged = {};
        
        // Primero todos los locales
        localList.forEach(item => {
            if (item && item.id) {
                merged[item.id] = item;
            }
        });
        
        // Luego los de la nube (sobrescriben si existen, agregan si no)
        cloudList.forEach(item => {
            if (item && item.id) {
                merged[item.id] = item;
            }
        });
        
        return Object.values(merged);
    }

    // ──────────────────────────────────────────────────────────
    // 4. SINCRONIZACIÓN CON GITHUB
    // ──────────────────────────────────────────────────────────

    let currentSha = null;
    let isSyncing = false;
    let syncTimeout = null;

    function getApiUrl(config) {
        return `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${config.path}`;
    }

    // ═══ SUBIR A GITHUB ═══
    async function uploadToGitHub(data) {
        const config = getGitHubConfig();
        
        if (!config.token) {
            console.warn('[QCOL Cloud] ⚠️ Token no configurado');
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

            const response = await fetch(getApiUrl(config), {
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
            
            console.log('[QCOL Cloud] ✅ Subido a GitHub');
            return true;
        } catch (error) {
            console.warn('[QCOL Cloud] ⚠️ Error subiendo:', error.message);
            return false;
        }
    }

    // ═══ DESCARGAR DE GITHUB (MERGE, NUNCA BORRAR) ═══
    async function downloadFromGitHub() {
        const config = getGitHubConfig();
        
        try {
            const response = await fetch(getApiUrl(config), {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    ...(config.token ? { 'Authorization': `token ${config.token}` } : {})
                }
            });

            if (response.status === 404) {
                console.log('[QCOL Cloud] ℹ️ Archivo no existe en GitHub');
                return false;
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            currentSha = result.sha;

            const content = atob(result.content.replace(/\n/g, ''));
            const cloudData = JSON.parse(content);

            console.log('[QCOL Cloud] 📥 Descargado de GitHub:', Object.keys(cloudData));

            // ═══ APLICAR MERGE (NUNCA SOBRESCRIBIR CON VACÍO) ═══
            let updated = false;

            // Apps publicadas
            if (cloudData.puzzle !== undefined) {
                const local = getData('qcol_published_quantum_apps');
                const merged = mergeLists(local, cloudData.puzzle);
                if (JSON.stringify(merged) !== JSON.stringify(local)) {
                    setData('qcol_published_quantum_apps', merged);
                    updated = true;
                    console.log('[QCOL Cloud] 📊 Publicadas:', merged.length);
                }
            }

            // Apps pendientes
            if (cloudData.pending !== undefined) {
                const local = getData('qcol_pending_quantum_apps');
                const merged = mergeLists(local, cloudData.pending);
                if (JSON.stringify(merged) !== JSON.stringify(local)) {
                    setData('qcol_pending_quantum_apps', merged);
                    updated = true;
                    console.log('[QCOL Cloud] 📊 Pendientes:', merged.length);
                }
            }

            // Apps del Studio
            if (cloudData.quantum_apps !== undefined) {
                const local = getData('quantum_apps_repo_v2');
                const merged = mergeLists(local, cloudData.quantum_apps);
                if (JSON.stringify(merged) !== JSON.stringify(local)) {
                    setData('quantum_apps_repo_v2', merged);
                    updated = true;
                    console.log('[QCOL Cloud] 📊 Studio:', merged.length);
                }
            }

            // Proyectos
            if (cloudData.projects !== undefined) {
                const local = getData('qcol_projs');
                const merged = mergeLists(local, cloudData.projects);
                if (JSON.stringify(merged) !== JSON.stringify(local)) {
                    setData('qcol_projs', merged);
                    updated = true;
                }
            }

            // Biblioteca
            if (cloudData.library !== undefined) {
                const local = getData('qcol_library');
                const merged = mergeLists(local, cloudData.library);
                if (JSON.stringify(merged) !== JSON.stringify(local)) {
                    setData('qcol_library', merged);
                    updated = true;
                }
            }

            // Configuración (solo si no está vacía)
            if (cloudData.config) {
                const cfg = cloudData.config;
                if (cfg.colab_url) localStorage.setItem('qcol_colab_url', cfg.colab_url);
                if (cfg.ai) setData('qcol_ai', cfg.ai);
                if (cfg.github) setData('qcol_gh', cfg.github);
                if (cfg.platform) setData('qcol_cfg', cfg.platform);
                if (cfg.system) setData('qcol_sys', cfg.system);
                if (cfg.monitor) setData('qcol_monitor_cfg', cfg.monitor);
                if (cfg.founder_pass) localStorage.setItem('qcol_fp', cfg.founder_pass);
                updated = true;
            }

            // Guardar timestamp
            if (updated && cloudData.timestamp) {
                localStorage.setItem('_qcol_cloud_timestamp', cloudData.timestamp);
                console.log('[QCOL Cloud] ✅ MERGE completado (nunca se borraron datos)');
                
                // Notificar actualización
                window.dispatchEvent(new CustomEvent('qcol-cloud-update'));
            }

            return true;
        } catch (error) {
            console.warn('[QCOL Cloud] ⚠️ Error descargando:', error.message);
            return false;
        }
    }

    // ═══ SINCRONIZACIÓN COMPLETA ═══
    async function fullSync() {
        if (isSyncing) return;
        isSyncing = true;
        
        try {
            console.log('[QCOL Cloud] 🔄 Sincronizando...');
            
            // Descargar y hacer MERGE
            await downloadFromGitHub();
            
            // Subir datos fusionados
            const data = {
                projects: getData('qcol_projs'),
                library: getData('qcol_library'),
                puzzle: getData('qcol_published_quantum_apps'),
                pending: getData('qcol_pending_quantum_apps'),
                quantum_apps: getData('quantum_apps_repo_v2'),
                config: {
                    colab_url: localStorage.getItem('qcol_colab_url') || '',
                    ai: getData('qcol_ai'),
                    github: getData('qcol_gh'),
                    platform: getData('qcol_cfg'),
                    system: getData('qcol_sys'),
                    monitor: getData('qcol_monitor_cfg'),
                    founder_pass: localStorage.getItem('qcol_fp') || ''
                },
                timestamp: new Date().toISOString(),
                version: '1.0.0'
            };
            
            await uploadToGitHub(data);
            
            console.log('[QCOL Cloud] ✅ Sincronización completada');
        } catch(e) {
            console.warn('[QCOL Cloud] ⚠️ Error:', e.message);
        } finally {
            isSyncing = false;
        }
    }

    // ──────────────────────────────────────────────────────────
    // 5. INTERCEPTOR DE LOCALSTORAGE
    // ──────────────────────────────────────────────────────────

    const originalSetItem = localStorage.setItem;
    
    localStorage.setItem = function(key, value) {
        originalSetItem.call(this, key, value);
        
        if (SYNC_KEYS.includes(key)) {
            if (syncTimeout) clearTimeout(syncTimeout);
            syncTimeout = setTimeout(() => {
                fullSync();
                syncTimeout = null;
            }, 2000);
        }
    };

    // ──────────────────────────────────────────────────────────
    // 6. INICIALIZACIÓN
    // ──────────────────────────────────────────────────────────

    async function init() {
        console.log('[QCOL Cloud] 🚀 Iniciando...');
        console.log('[QCOL Cloud] 📋 Claves:', SYNC_KEYS);

        const config = getGitHubConfig();
        if (!config.token) {
            console.warn('[QCOL Cloud] ⚠️ Token no configurado');
            console.warn('[QCOL Cloud] 💡 Ve al Panel Fundador → GitHub');
        } else {
            console.log('[QCOL Cloud] ✅ GitHub:', config.owner + '/' + config.repo);
        }

        // Primera sincronización
        await fullSync();

        // Sincronizar cada 30 segundos
        setInterval(() => {
            if (!isSyncing) {
                fullSync();
            }
        }, 30000);

        console.log('[QCOL Cloud] ✅ Activo');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Exponer funciones
    window.__QCOL_CLOUD = {
        sync: fullSync,
        status: () => {
            return {
                pending: getData('qcol_pending_quantum_apps').length,
                published: getData('qcol_published_quantum_apps').length,
                studio: getData('quantum_apps_repo_v2').length,
                pendingApps: getData('qcol_pending_quantum_apps').map(a => a.name || a.id),
                publishedApps: getData('qcol_published_quantum_apps').map(a => a.name || a.id)
            };
        }
    };

})();