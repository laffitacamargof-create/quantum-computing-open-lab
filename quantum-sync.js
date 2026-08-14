// ============================================================
// QUANTUM SYNC MODULE · Supabase Cloud Synchronization (CORREGIDO)
// ============================================================

class QuantumSync {
    constructor(config) {
        this.SUPABASE_URL = config.supabaseUrl || 'https://tu-proyecto.supabase.co';
        this.SUPABASE_ANON_KEY = config.supabaseAnonKey || 'tu-anon-key';
        this.SUPABASE_SERVICE_KEY = config.supabaseServiceKey || 'tu-service-key';
        
        this.TABLES = {
            PENDING_APPS: 'quantum_pending_apps',
            PUBLISHED_APPS: 'quantum_published_apps'
        };
        
        this.isInitialized = false;
        this.isReady = false;
        this.currentUser = null;
        this.userRole = null;
        this.syncInterval = null;
        this.pendingApps = [];
        this.publishedApps = [];
        this.studioConnected = false;
        this.puzzleConnected = false;
        
        this.onPendingUpdate = null;
        this.onPublishedUpdate = null;
        this.onAppPublished = null;
        this.onAppRejected = null;
        
        this.compilerUrls = new Map();
    }

    // ==================== INICIALIZACIÓN ====================
    
    async init() {
        try {
            console.log('🔌 Probando conexión a Supabase...');
            console.log('📌 URL:', this.SUPABASE_URL);
            console.log('📌 ANON KEY:', this.SUPABASE_ANON_KEY ? '✅ Presente' : '❌ Faltante');
            
            // ✅ Intentar conexión directamente a la tabla
            let testResponse = await fetch(`${this.SUPABASE_URL}/rest/v1/${this.TABLES.PENDING_APPS}?select=id&limit=1`, {
                method: 'GET',
                headers: {
                    'apikey': this.SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`
                }
            });
            
            // Si falla con anon, intentar con service_role
            if (testResponse.status === 401 || testResponse.status === 403) {
                console.log('🔄 Intentando con service_role...');
                testResponse = await fetch(`${this.SUPABASE_URL}/rest/v1/${this.TABLES.PENDING_APPS}?select=id&limit=1`, {
                    method: 'GET',
                    headers: {
                        'apikey': this.SUPABASE_SERVICE_KEY,
                        'Authorization': `Bearer ${this.SUPABASE_SERVICE_KEY}`
                    }
                });
            }
            
            if (!testResponse.ok) {
                // Si la tabla no existe, crearla
                if (testResponse.status === 404) {
                    console.log('📋 Tablas no encontradas. Creando...');
                    await this._createTables();
                    // Reintentar
                    testResponse = await fetch(`${this.SUPABASE_URL}/rest/v1/${this.TABLES.PENDING_APPS}?select=id&limit=1`, {
                        method: 'GET',
                        headers: {
                            'apikey': this.SUPABASE_ANON_KEY,
                            'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`
                        }
                    });
                }
                
                if (!testResponse.ok) {
                    console.warn(`⚠️ Error de conexión: HTTP ${testResponse.status}`);
                    console.warn('⚠️ Modo offline/local activado.');
                    this.isInitialized = false;
                    this.isReady = false;
                    return false;
                }
            }
            
            console.log('✅ Conexión a Supabase establecida');
            
            await this.syncAll();
            
            this.isInitialized = true;
            this.isReady = true;
            console.log('✅ Quantum Sync Module initialized');
            
            this.syncInterval = setInterval(() => this.syncAll(), 30000);
            
            return true;
        } catch (error) {
            console.error('❌ Error initializing Quantum Sync:', error.message);
            this.isInitialized = false;
            this.isReady = false;
            return false;
        }
    }

    // ==================== CREAR TABLAS ====================
    
    async _createTables() {
        // Intentar crear tablas usando SQL directo
        const createSQL = `
            CREATE TABLE IF NOT EXISTS quantum_pending_apps (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                tags TEXT,
                duration INTEGER DEFAULT 8,
                python_code TEXT,
                html_code TEXT,
                server_url TEXT,
                created_by TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                status TEXT DEFAULT 'pending',
                submitted_by TEXT,
                submitted_at TIMESTAMP DEFAULT NOW()
            );
            
            CREATE TABLE IF NOT EXISTS quantum_published_apps (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                tags TEXT,
                duration INTEGER DEFAULT 8,
                python_code TEXT,
                html_code TEXT,
                server_url TEXT,
                created_by TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW(),
                published_by TEXT,
                published_at TIMESTAMP DEFAULT NOW(),
                version INTEGER DEFAULT 1,
                is_active BOOLEAN DEFAULT true
            );
            
            ALTER TABLE quantum_pending_apps ENABLE ROW LEVEL SECURITY;
            ALTER TABLE quantum_published_apps ENABLE ROW LEVEL SECURITY;
            
            DROP POLICY IF EXISTS "Allow all" ON quantum_pending_apps;
            CREATE POLICY "Allow all" ON quantum_pending_apps FOR ALL USING (true) WITH CHECK (true);
            
            DROP POLICY IF EXISTS "Allow all" ON quantum_published_apps;
            CREATE POLICY "Allow all" ON quantum_published_apps FOR ALL USING (true) WITH CHECK (true);
        `;
        
        try {
            const response = await fetch(`${this.SUPABASE_URL}/rest/v1/rpc/pgadmin_exec`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': this.SUPABASE_SERVICE_KEY,
                    'Authorization': `Bearer ${this.SUPABASE_SERVICE_KEY}`
                },
                body: JSON.stringify({ query: createSQL })
            });
            
            if (!response.ok) {
                console.warn('⚠️ No se pudieron crear las tablas automáticamente.');
                console.warn('⚠️ Por favor, crea las tablas manualmente en SQL Editor.');
            }
        } catch (error) {
            console.warn('⚠️ Error creando tablas:', error.message);
            console.warn('⚠️ Por favor, crea las tablas manualmente en SQL Editor.');
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

    // ==================== OPERACIONES ====================
    
    async submitApp(appData) {
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
            const existing = await this._supabaseFetch(this.TABLES.PENDING_APPS, {
                select: 'id',
                eq: { id: pendingApp.id }
            });
            
            if (existing && existing.length > 0) {
                await this._supabaseUpdate(this.TABLES.PENDING_APPS, pendingApp.id, pendingApp);
            } else {
                await this._supabaseInsert(this.TABLES.PENDING_APPS, pendingApp);
            }
            
            await this.syncPendingApps();
            
            console.log(`📤 App "${pendingApp.title}" submitted for approval`);
            return pendingApp;
        } catch (error) {
            console.error('Error submitting app:', error.message);
            this._saveLocalPending(pendingApp);
            throw error;
        }
    }

    async approveApp(appId, reviewerId = null) {
        try {
            const pendingApps = await this._supabaseFetch(this.TABLES.PENDING_APPS, {
                select: '*',
                eq: { id: appId }
            });
            
            if (!pendingApps || pendingApps.length === 0) {
                throw new Error('App not found in pending queue');
            }
            
            const pendingApp = pendingApps[0];
            
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
            
            await this._supabaseInsert(this.TABLES.PUBLISHED_APPS, publishedApp);
            await this._supabaseDelete(this.TABLES.PENDING_APPS, appId);
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
            const pendingApps = await this._supabaseFetch(this.TABLES.PENDING_APPS, {
                select: '*',
                eq: { id: appId }
            });
            
            const appName = pendingApps && pendingApps.length > 0 
                ? pendingApps[0].title 
                : appId;
            
            await this._supabaseDelete(this.TABLES.PENDING_APPS, appId);
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

    // ==================== INTEGRACIONES ====================
    
    connectStudio(iframe) {
        this.studioConnected = true;
        
        window.addEventListener('message', async (event) => {
            const data = event.data;
            if (!data || typeof data !== 'object') return;
            if (!this.studioConnected) return;
            
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