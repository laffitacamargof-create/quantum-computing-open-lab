// ============================================================
// QUANTUM SYNC MODULE · Supabase Cloud Synchronization
// ============================================================
// Este módulo se encarga de sincronizar las aplicaciones entre
// Quantum App Studio y Quantum Puzzle usando Supabase como backend.
// 
// Flujo: Studio crea/edita app → Pending (solo admins/founders ven)
//        Admin/Founder aprueba → Public (todos ven en Puzzle)
//        Admin/Founder rechaza → Eliminado
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
            // Verificar conexión con Supabase
            const { data, error } = await this._supabaseQuery('ping');
            if (error) {
                console.warn('⚠️ No se pudo conectar a Supabase. Modo offline/local activado.');
                this.isInitialized = false;
                return false;
            }
            
            // Crear tablas si no existen (se hace en el dashboard de Supabase)
            await this._ensureTablesExist();
            
            // Cargar datos iniciales
            await this.syncAll();
            
            this.isInitialized = true;
            console.log('✅ Quantum Sync Module initialized');
            
            // Iniciar sincronización automática cada 30 segundos
            this.syncInterval = setInterval(() => this.syncAll(), 30000);
            
            return true;
        } catch (error) {
            console.error('❌ Error initializing Quantum Sync:', error);
            this.isInitialized = false;
            return false;
        }
    }

    // ==================== CONFIGURACIÓN DE SUPABASE ====================
    
    async _supabaseQuery(query, params = {}) {
        // Esta es una implementación simplificada.
        // En producción, usa la librería oficial de Supabase.
        try {
            const url = `${this.SUPABASE_URL}/rest/v1/rpc/${query}`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': this.SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`
                },
                body: JSON.stringify(params)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            return { data, error: null };
        } catch (error) {
            return { data: null, error };
        }
    }

    async _supabaseFetch(table, options = {}) {
        const url = new URL(`${this.SUPABASE_URL}/rest/v1/${table}`);
        
        if (options.select) url.searchParams.append('select', options.select);
        if (options.eq) {
            Object.entries(options.eq).forEach(([key, value]) => {
                url.searchParams.append(`${key}`, `eq.${value}`);
            });
        }
        if (options.order) {
            url.searchParams.append('order', `${options.order.column}.${options.order.direction || 'asc'}`);
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
            throw new Error(`HTTP ${response.status}`);
        }
        
        return await response.json();
    }

    async _supabaseInsert(table, data) {
        const url = new URL(`${this.SUPABASE_URL}/rest/v1/${table}`);
        
        const response = await fetch(url, {
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
            throw new Error(`HTTP ${response.status}`);
        }
        
        return await response.json();
    }

    async _supabaseUpdate(table, id, data) {
        const url = new URL(`${this.SUPABASE_URL}/rest/v1/${table}`);
        url.searchParams.append('id', `eq.${id}`);
        
        const response = await fetch(url, {
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
            throw new Error(`HTTP ${response.status}`);
        }
        
        return await response.json();
    }

    async _supabaseDelete(table, id) {
        const url = new URL(`${this.SUPABASE_URL}/rest/v1/${table}`);
        url.searchParams.append('id', `eq.${id}`);
        
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'apikey': this.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        return true;
    }

    // ==================== CREACIÓN DE TABLAS ====================
    
    async _ensureTablesExist() {
        // En una implementación real, las tablas se crean en el dashboard de Supabase.
        // Aquí solo verificamos que existan.
        try {
            await this._supabaseFetch(this.TABLES.PENDING_APPS, { select: 'id', limit: 1 });
            await this._supabaseFetch(this.TABLES.PUBLISHED_APPS, { select: 'id', limit: 1 });
        } catch (error) {
            console.warn('⚠️ Tablas de Quantum Sync no encontradas. Creándolas...');
            await this._createTables();
        }
    }

    async _createTables() {
        // Esta función solo se ejecuta en el entorno de desarrollo.
        // En producción, las tablas se crean via migrations.
        console.log('📋 Por favor, crea las siguientes tablas en Supabase:');
        console.log(`
        CREATE TABLE IF NOT EXISTS ${this.TABLES.PENDING_APPS} (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            title TEXT NOT NULL,
            desc TEXT,
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
        
        CREATE TABLE IF NOT EXISTS ${this.TABLES.PUBLISHED_APPS} (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            title TEXT NOT NULL,
            desc TEXT,
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
        
        CREATE TABLE IF NOT EXISTS ${this.TABLES.APP_VERSIONS} (
            id SERIAL PRIMARY KEY,
            app_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            python_code TEXT,
            html_code TEXT,
            published_by TEXT,
            published_at TIMESTAMP DEFAULT NOW(),
            change_notes TEXT
        );
        `);
    }

    // ==================== SINCORNIZACIÓN PRINCIPAL ====================
    
    async syncAll() {
        try {
            await this.syncPendingApps();
            await this.syncPublishedApps();
            return true;
        } catch (error) {
            console.error('❌ Sync error:', error);
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
            console.error('Error syncing pending apps:', error);
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
            console.error('Error syncing published apps:', error);
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
            desc: appData.desc || appData.description || '',
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
            console.error('Error submitting app:', error);
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
                desc: pendingApp.desc,
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
            console.error('Error approving app:', error);
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
            console.error('Error rejecting app:', error);
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
            console.error('Error updating published app:', error);
            throw error;
        }
    }

    async deletePublishedApp(appId) {
        try {
            await this._supabaseDelete(this.TABLES.PUBLISHED_APPS, appId);
            await this.syncPublishedApps();
            return true;
        } catch (error) {
            console.error('Error deleting published app:', error);
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
                // El Studio guardó una app localmente, la sincronizamos como pending
                if (data.appId && data.appData) {
                    const appData = data.appData;
                    try {
                        await this.submitApp({
                            id: data.appId,
                            name: appData.name || appData.title,
                            title: appData.title || appData.name,
                            desc: appData.desc || '',
                            tags: appData.tags || '',
                            pythonCode: appData.pythonCode || '',
                            htmlCode: appData.htmlCode || '',
                            serverUrl: appData.serverUrl || '',
                            duration: appData.duration || 8
                        });
                    } catch (error) {
                        console.warn('⚠️ Could not sync app to cloud:', error);
                    }
                }
            }
            
            if (data.type === 'QCOL_STUDIO_OPENED') {
                // Responder con la URL del compilador si está configurada
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
        
        // Escuchar mensajes del Puzzle
        window.addEventListener('message', async (event) => {
            const data = event.data;
            if (!data || typeof data !== 'object') return;
            
            if (!this.puzzleConnected) return;
            
            // Mensajes de Quantum Puzzle
            if (data.type === 'QCOL_REQUEST_PENDING_APPS') {
                // Solo admins/founders pueden ver pending apps
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
        
        // Notificar a los componentes
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

// ============================================================
// EXPORTAR MÓDULO
// ============================================================
// Uso:
// const sync = new QuantumSync({
//     supabaseUrl: 'https://tu-proyecto.supabase.co',
//     supabaseAnonKey: 'tu-anon-key',
//     supabaseServiceKey: 'tu-service-key'
// });
// await sync.init();
// sync.setUser({ id: 'user-123', name: 'John', role: 'founder' });
// ============================================================

export default QuantumSync;

// ============================================================
// INTEGRACIÓN AUTOMÁTICA CON QUANTUM PUZZLE
// ============================================================
// Para integrar este módulo en Quantum Puzzle, agrega al inicio
// de qcol-quantum-puzzle.html:
//
// <script type="module">
// import QuantumSync from './quantum-sync.js';
// window.quantumSync = new QuantumSync({
//     supabaseUrl: 'https://tu-proyecto.supabase.co',
//     supabaseAnonKey: 'tu-anon-key'
// });
// window.quantumSync.init();
// </script>
//
// Luego reemplaza las funciones getPublishedApps(), getPendingApps(),
// savePublishedApps(), savePendingApps() con las versiones sincronizadas.
// ============================================================