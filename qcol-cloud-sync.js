// ============================================================
// QUANTUM SYNC MODULE · Supabase Cloud Synchronization (CORREGIDO)
// ============================================================

class QuantumSync {
    constructor(config) {
        // Configuración de Supabase
        this.SUPABASE_URL = config.supabaseUrl || 'https://tu-proyecto.supabase.co';
        this.SUPABASE_ANON_KEY = config.supabaseAnonKey || 'tu-anon-key';
        this.SUPABASE_SERVICE_KEY = config.supabaseServiceKey || 'tu-service-key';
        
        // Tablas en Supabase
        this.TABLES = {
            PENDING_APPS: 'quantum_pending_apps',
            PUBLISHED_APPS: 'quantum_published_apps',
            APP_VERSIONS: 'quantum_app_versions'
        };
        
        // Estado local
        this.isInitialized = false;
        this.currentUser = null;
        this.userRole = null;
        this.syncInterval = null;
        this.pendingApps = [];
        this.publishedApps = [];
        this.studioConnected = false;
        this.puzzleConnected = false;
        
        // Callbacks para notificar cambios
        this.onPendingUpdate = null;
        this.onPublishedUpdate = null;
        this.onAppPublished = null;
        this.onAppRejected = null;
        
        // Cache de URLs de servidor
        this.compilerUrls = new Map();
    }

    // ==================== INICIALIZACIÓN ====================
    
    async init() {
        try {
            console.log('🔌 Probando conexión a Supabase...');
            console.log('📌 URL:', this.SUPABASE_URL);
            console.log('📌 ANON KEY:', this.SUPABASE_ANON_KEY ? '✅ Presente' : '❌ Faltante');
            
            // Verificar conexión con Supabase - usar HEAD en lugar de ping
            const testResponse = await fetch(`${this.SUPABASE_URL}/rest/v1/`, {
                method: 'HEAD',
                headers: {
                    'apikey': this.SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`
                }
            });
            
            if (!testResponse.ok) {
                console.warn(`⚠️ Error de conexión: HTTP ${testResponse.status}`);
                console.warn('⚠️ Modo offline/local activado.');
                this.isInitialized = false;
                return false;
            }
            
            console.log('✅ Conexión a Supabase establecida');
            
            // Cargar datos iniciales
            await this.syncAll();
            
            this.isInitialized = true;
            console.log('✅ Quantum Sync Module initialized');
            
            // Iniciar sincronización automática cada 30 segundos
            this.syncInterval = setInterval(() => this.syncAll(), 30000);
            
            return true;
        } catch (error) {
            console.error('❌ Error initializing Quantum Sync:', error.message);
            this.isInitialized = false;
            return false;
        }
    }

    // ==================== CONFIGURACIÓN DE SUPABASE ====================
    
    async _supabaseFetch(table, options = {}) {
        const url = new URL(`${this.SUPABASE_URL}/rest/v1/${table}`);
        
        if (options.select) url.searchParams.append('select', options.select);
        if (options.eq) {
            Object.entries(options.eq).forEach(([key, value]) => {
                url.searchParams.append(key, `eq.${value}`);
            });
        }
        if (options.order) {
            url.searchParams.append('order', `${options.order.column}.${options.order.direction || 'asc'}`);
        }
        if (options.limit) {
            url.searchParams.append('limit', options.limit);
        }
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'apikey': this.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return await response.json();
    }

    async _supabaseInsert(table, data) {
        const response = await fetch(`${this.SUPABASE_URL}/rest/v1/${table}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': this.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`,
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return await response.json();
    }

    async _supabaseUpdate(table, id, data) {
        const response = await fetch(`${this.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'apikey': this.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`,
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(data)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return await response.json();
    }

    async _supabaseDelete(table, id) {
        const response = await fetch(`${this.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'apikey': this.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return true;
    }

    // ==================== SINCORNIZACIÓN PRINCIPAL ====================
    
    async syncAll() {
        try {
            await this.syncPendingApps();
            await this.syncPublishedApps();
            return true;
        } catch (error) {
            console.error('❌ Sync error:', error.message);
            return false;
        }
    }

    async syncPendingApps() {
        try {
            const data = await this._supabaseFetch(this.TABLES.PENDING_APPS, {
                select: '*',
                order: { column: 'created_at', direction: 'desc' }
            });
            
            this.pendingApps = data || [];
            
            if (this.onPendingUpdate) {
                this.onPendingUpdate(this.pendingApps);
            }
            
            return this.pendingApps;
        } catch (error) {
            console.error('Error syncing pending apps:', error.message);
            return [];
        }
    }

    async syncPublishedApps() {
        try {
            const data = await this._supabaseFetch(this.TABLES.PUBLISHED_APPS, {
                select: '*',
                order: { column: 'created_at', direction: 'desc' }
            });
            
            this.publishedApps = data || [];
            
            if (this.onPublishedUpdate) {
                this.onPublishedUpdate(this.publishedApps);
            }
            
            return this.publishedApps;
        } catch (error) {
            console.error('Error syncing published apps:', error.message);
            return [];
        }
    }

    // ==================== OPERACIONES CON APPS PENDIENTES ====================
    
    async submitApp(appData) {
        // Validar datos
        if (!appData.id) {
            appData.id = this._generateId();
        }
        
        const pendingApp = {
            id: appData.id,
            name: appData.name || appData.title || 'Untitled App',
            title: appData.title || appData.name || 'Untitled App',
            description: appData.desc || appData.description || '',
            tags: appData.tags || '',
            duration: appData.duration || 8,
            python_code: appData.pythonCode || appData.python_code || '',
            html_code: appData.htmlCode || appData.html_code || '',
            server_url: appData.serverUrl || appData.server_url || '',
            created_by: appData.createdBy || this.currentUser?.id || 'anonymous',
            created_at: new Date().toISOString(),
            submitted_by: this.currentUser?.id || 'anonymous',
            submitted_at: new Date().toISOString(),
            status: 'pending'
        };
        
        try {
            // Verificar si ya existe
            const existing = await this._supabaseFetch(this.TABLES.PENDING_APPS, {
                select: 'id',
                eq: { id: pendingApp.id }
            });
            
            if (existing && existing.length > 0) {
                // Actualizar
                await this._supabaseUpdate(this.TABLES.PENDING_APPS, pendingApp.id, pendingApp);
            } else {
                // Insertar
                await this._supabaseInsert(this.TABLES.PENDING_APPS, pendingApp);
            }
            
            // Actualizar cache local
            await this.syncPendingApps();
            
            console.log(`📤 App "${pendingApp.title}" submitted for approval`);
            return pendingApp;
        } catch (error) {
            console.error('Error submitting app:', error.message);
            // Fallback: guardar localmente
            this._saveLocalPending(pendingApp);
            throw error;
        }
    }

    async approveApp(appId, reviewerId = null) {
        try {
            // Obtener la app pendiente
            const pendingApps = await this._supabaseFetch(this.TABLES.PENDING_APPS, {
                select: '*',
                eq: { id: appId }
            });
            
            if (!pendingApps || pendingApps.length === 0) {
                throw new Error('App not found in pending queue');
            }
            
            const pendingApp = pendingApps[0];
            
            // Crear app publicada
            const publishedApp = {
                id: pendingApp.id,
                name: pendingApp.name,
                title: pendingApp.title,
                description: pendingApp.description,
                tags: pendingApp.tags,
                duration: pendingApp.duration,
                python_code: pendingApp.python_code,
                html_code: pendingApp.html_code,
                server_url: pendingApp.server_url,
                created_by: pendingApp.created_by,
                created_at: pendingApp.created_at,
                published_by: reviewerId || this.currentUser?.id || 'admin',
                published_at: new Date().toISOString(),
                version: 1,
                is_active: true
            };
            
            // Publicar
            await this._supabaseInsert(this.TABLES.PUBLISHED_APPS, publishedApp);
            
            // Eliminar de pendientes
            await this._supabaseDelete(this.TABLES.PENDING_APPS, appId);
            
            // Sincronizar
            await this.syncAll();
            
            if (this.onAppPublished) {
                this.onAppPublished(publishedApp);
            }
            
            console.log(`✅ App "${pendingApp.title}" published!`);
            return publishedApp;
        } catch (error) {
            console.error('Error approving app:', error.message);
            throw error;
        }
    }

    async rejectApp(appId) {
        try {
            // Obtener la app pendiente para notificación
            const pendingApps = await this._supabaseFetch(this.TABLES.PENDING_APPS, {
                select: '*',
                eq: { id: appId }
            });
            
            const appName = pendingApps && pendingApps.length > 0 
                ? pendingApps[0].title 
                : appId;
            
            // Eliminar de pendientes
            await this._supabaseDelete(this.TABLES.PENDING_APPS, appId);
            
            // Sincronizar
            await this.syncPendingApps();
            
            if (this.onAppRejected) {
                this.onAppRejected(appId);
            }
            
            console.log(`🗑️ App "${appName}" rejected`);
            return true;
        } catch (error) {
            console.error('Error rejecting app:', error.message);
            throw error;
        }
    }

    // ==================== OPERACIONES CON APPS PUBLICADAS ====================
    
    async updatePublishedApp(appId, updates) {
        try {
            // Actualizar en Supabase
            const updated = await this._supabaseUpdate(
                this.TABLES.PUBLISHED_APPS,
                appId,
                {
                    ...updates,
                    updated_at: new Date().toISOString()
                }
            );
            
            // Sincronizar
            await this.syncPublishedApps();
            
            return updated;
        } catch (error) {
            console.error('Error updating published app:', error.message);
            throw error;
        }
    }

    async deletePublishedApp(appId) {
        try {
            await this._supabaseDelete(this.TABLES.PUBLISHED_APPS, appId);
            await this.syncPublishedApps();
            return true;
        } catch (error) {
            console.error('Error deleting published app:', error.message);
            throw error;
        }
    }

    // ==================== INTEGRACIÓN CON QUANTUM APP STUDIO ====================
    
    connectStudio(iframe) {
        this.studioConnected = true;
        
        // Escuchar mensajes del Studio
        window.addEventListener('message', async (event) => {
            const data = event.data;
            if (!data || typeof data !== 'object') return;
            
            // Solo procesar mensajes del Studio si está conectado
            if (!this.studioConnected) return;
            
            // Mensajes de Quantum App Studio
            if (data.type === 'QCOL_APP_SAVED') {
                if (data.appId && data.appData) {
                    const appData = data.appData;
                    try {
                        await this.submitApp({
                            id: data.appId,
                            name: appData.name || appData.title,
                            title: appData.title || appData.name,
                            description: appData.desc || appData.description || '',
                            tags: appData.tags || '',
                            pythonCode: appData.pythonCode || '',
                            htmlCode: appData.htmlCode || '',
                            serverUrl: appData.serverUrl || '',
                            duration: appData.duration || 8
                        });
                    } catch (error) {
                        console.warn('⚠️ Could not sync app to cloud:', error.message);
                    }
                }
            }
            
            if (data.type === 'QCOL_STUDIO_OPENED') {
                if (this.compilerUrls.size > 0) {
                    const url = this.compilerUrls.values().next().value;
                    if (event.source) {
                        event.source.postMessage({
                            type: 'QCOL_COMPILER_URL',
                            url: url
                        }, '*');
                    }
                }
            }
        });
    }

    // ==================== INTEGRACIÓN CON QUANTUM PUZZLE ====================
    
    connectPuzzle() {
        this.puzzleConnected = true;
        
        window.addEventListener('message', async (event) => {
            const data = event.data;
            if (!data || typeof data !== 'object') return;
            
            if (!this.puzzleConnected) return;
            
            if (data.type === 'QCOL_REQUEST_PENDING_APPS') {
                if (this.userRole === 'admin' || this.userRole === 'founder') {
                    const pendingApps = await this.syncPendingApps();
                    if (event.source) {
                        event.source.postMessage({
                            type: 'QCOL_PENDING_APPS_LIST',
                            apps: pendingApps
                        }, '*');
                    }
                }
            }
            
            if (data.type === 'QCOL_APPROVE_APP') {
                if (this.userRole === 'admin' || this.userRole === 'founder') {
                    try {
                        const published = await this.approveApp(data.appId, this.currentUser?.id);
                        if (event.source) {
                            event.source.postMessage({
                                type: 'QCOL_APP_APPROVED',
                                app: published
                            }, '*');
                        }
                    } catch (error) {
                        if (event.source) {
                            event.source.postMessage({
                                type: 'QCOL_APP_APPROVED',
                                error: error.message
                            }, '*');
                        }
                    }
                }
            }
            
            if (data.type === 'QCOL_REJECT_APP') {
                if (this.userRole === 'admin' || this.userRole === 'founder') {
                    try {
                        await this.rejectApp(data.appId);
                        if (event.source) {
                            event.source.postMessage({
                                type: 'QCOL_APP_REJECTED',
                                appId: data.appId
                            }, '*');
                        }
                    } catch (error) {
                        if (event.source) {
                            event.source.postMessage({
                                type: 'QCOL_APP_REJECTED',
                                error: error.message
                            }, '*');
                        }
                    }
                }
            }
        });
    }

    // ==================== UTILIDADES ====================
    
    _generateId() {
        return Date.now() + '-' + Math.random().toString(36).substring(2, 10);
    }

    _saveLocalPending(appData) {
        try {
            const pending = JSON.parse(localStorage.getItem('qcol_pending_quantum_apps') || '[]');
            const existing = pending.find(p => p.id === appData.id);
            if (existing) {
                Object.assign(existing, appData);
            } else {
                pending.push(appData);
            }
            localStorage.setItem('qcol_pending_quantum_apps', JSON.stringify(pending));
        } catch (error) {
            console.error('Error saving local pending app:', error);
        }
    }

    // ==================== CONFIGURACIÓN DE USUARIO ====================
    
    setUser(user) {
        this.currentUser = user;
        this.userRole = user?.role || 'user';
        this._notifyUserUpdate();
    }

    _notifyUserUpdate() {
        window.postMessage({
            type: 'QCOL_USER_UPDATE',
            user: this.currentUser,
            role: this.userRole
        }, '*');
    }

    // ==================== LIMPIEZA ====================
    
    destroy() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        this.studioConnected = false;
        this.puzzleConnected = false;
    }
}

export default QuantumSync;