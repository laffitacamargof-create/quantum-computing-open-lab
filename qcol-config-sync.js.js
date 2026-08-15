// ============================================================
// QCOL CONFIG SYNC - Sincronización de configuración en la nube
// ============================================================

class QcolConfigSync {
    constructor(config) {
        this.SUPABASE_URL = config.supabaseUrl;
        this.SUPABASE_ANON_KEY = config.supabaseAnonKey;
        this.SUPABASE_SERVICE_KEY = config.supabaseServiceKey;
        
        this.isReady = false;
        this.currentUser = null;
        this.configCache = {};
        this.syncInterval = null;
        this._syncInProgress = false;
        this._syncingKeys = new Set();
        
        // Callbacks
        this.onConfigUpdate = null;
        this.onSyncComplete = null;
    }

    // ==================== INICIALIZACIÓN ====================
    
    async init() {
        try {
            console.log('🔌 Config Sync: Probando conexión...');
            
            const testResponse = await fetch(`${this.SUPABASE_URL}/rest/v1/quantum_ecosystem_config?select=key&limit=1`, {
                method: 'GET',
                headers: {
                    'apikey': this.SUPABASE_ANON_KEY,
                    'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`
                }
            });
            
            if (!testResponse.ok && testResponse.status !== 404) {
                console.warn('⚠️ Config Sync: Error de conexión');
                this.isReady = false;
                return false;
            }
            
            console.log('✅ Config Sync: Conexión establecida');
            await this.syncAll();
            
            this.isReady = true;
            console.log('✅ Config Sync inicializado');
            
            this.syncInterval = setInterval(() => this.syncAll(), 10000);
            
            return true;
        } catch (error) {
            console.error('❌ Config Sync error:', error.message);
            this.isReady = false;
            return false;
        }
    }

    // ==================== FUNCIONES BASE ====================
    
    async _fetch(table, options = {}) {
        let url = `${this.SUPABASE_URL}/rest/v1/${table}?select=*`;
        
        if (options.eq) {
            Object.entries(options.eq).forEach(([key, value]) => {
                url += `&${key}=eq.${value}`;
            });
        }
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'apikey': this.SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${this.SUPABASE_ANON_KEY}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    }

    async _insert(table, data) {
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
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    }

    async _update(table, key, data) {
        const response = await fetch(`${this.SUPABASE_URL}/rest/v1/${table}?key=eq.${key}`, {
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

    // ==================== SINCRONIZACIÓN COMPLETA ====================
    
    async syncAll() {
        if (this._syncInProgress) return;
        this._syncInProgress = true;
        try {
            // 🔧 TODAS las configuraciones incluyendo founder_password
            await this._syncConfig('colab_url', 'qcol_colab_url');
            await this._syncConfig('ai_config', 'qcol_ai');
            await this._syncConfig('github_config', 'qcol_gh');
            await this._syncConfig('deepseek_config', 'qcol_mistral');
            await this._syncConfig('system_config', 'qcol_sys');
            await this._syncConfig('platform_config', 'qcol_cfg');
            await this._syncConfig('monitor_config', 'qcol_monitor_cfg');
            await this._syncConfig('founder_password', 'qcol_fp');  // ✅ NUEVO
            
            if (this.onSyncComplete) this.onSyncComplete();
        } catch (error) {
            console.error('Config Sync error:', error.message);
        } finally {
            this._syncInProgress = false;
        }
    }

    async _syncConfig(cloudKey, localKey) {
        // ✅ Evitar sincronización en bucle
        if (this._syncingKeys.has(cloudKey)) {
            console.log(`⏭️ ${cloudKey} ya está sincronizando, skip`);
            return;
        }
        this._syncingKeys.add(cloudKey);
        
        try {
            // 1. Obtener valor de la nube
            const cloudData = await this._fetch('quantum_ecosystem_config', {
                eq: { key: cloudKey }
            });
            
            let cloudValue = null;
            let cloudTimestamp = null;
            if (cloudData && cloudData.length > 0) {
                cloudValue = cloudData[0].value;
                cloudTimestamp = new Date(cloudData[0].updated_at);
                try { cloudValue = JSON.parse(cloudValue); } catch(e) {}
                
                // 🔧 FORZAR founder_password como cadena SIEMPRE
                if (cloudKey === 'founder_password' && cloudValue !== null && cloudValue !== undefined) {
                    cloudValue = String(cloudValue);
                }
            }
            
            // 2. Obtener valor local
            let localValue = localStorage.getItem(localKey);
            try { localValue = JSON.parse(localValue); } catch(e) {}
            
            // 🔧 FORZAR founder_password como cadena en local también
            if (cloudKey === 'founder_password') {
                localValue = String(localValue || '');
            }
            
            const localTimestamp = localStorage.getItem(localKey + '_timestamp');
            const localTime = localTimestamp ? new Date(localTimestamp) : null;
            
            // 3. Comparar valores
            const localString = JSON.stringify(localValue);
            const cloudString = JSON.stringify(cloudValue);
            
            if (localString === cloudString && cloudValue !== null) {
                this._syncingKeys.delete(cloudKey);
                return;
            }
            
            // 4. Sincronizar
            if (cloudValue !== null && cloudValue !== undefined) {
                if (!localValue || (cloudTimestamp && localTime && cloudTimestamp > localTime)) {
                    // 🔧 Nube más reciente → actualizar local
                    const valueToStore = cloudKey === 'founder_password' ? String(cloudValue) : cloudValue;
                    localStorage.setItem(localKey, typeof valueToStore === 'string' ? valueToStore : JSON.stringify(valueToStore));
                    localStorage.setItem(localKey + '_timestamp', new Date().toISOString());
                    console.log(`📥 Config ${cloudKey} ACTUALIZADA desde la nube`);
                    
                    if (this.onConfigUpdate) this.onConfigUpdate(cloudKey, cloudValue);
                    if (typeof loadSaved === 'function') setTimeout(loadSaved, 100);
                    
                } else if (localValue && (!cloudTimestamp || !localTime || localTime > cloudTimestamp)) {
                    // 🔧 Local más reciente → actualizar nube
                    const valueToUpload = cloudKey === 'founder_password' ? String(localValue) : localValue;
                    await this._updateOrInsert(cloudKey, valueToUpload);
                    console.log(`📤 Config ${cloudKey} subida a la nube`);
                }
            } else if (localValue !== null && localValue !== undefined) {
                // Solo local → subir a la nube
                const valueToUpload = cloudKey === 'founder_password' ? String(localValue) : localValue;
                await this._updateOrInsert(cloudKey, valueToUpload);
                console.log(`📤 Config ${cloudKey} subida a la nube (nueva)`);
            }
        } catch (error) {
            console.warn(`⚠️ Error sincronizando ${cloudKey}:`, error.message);
        } finally {
            this._syncingKeys.delete(cloudKey);
        }
    }

    async _updateOrInsert(key, value) {
        // 🔧 FORZAR founder_password como cadena JSON con comillas
        let stringValue;
        if (key === 'founder_password') {
            stringValue = JSON.stringify(String(value));  // '"1027"'
        } else {
            stringValue = typeof value === 'string' ? value : JSON.stringify(value);
        }
        
        const data = {
            id: 'cfg-' + key,
            key: key,
            value: stringValue,
            updated_by: this.currentUser?.id || 'anonymous',
            updated_at: new Date().toISOString()
        };
        
        try {
            const existing = await this._fetch('quantum_ecosystem_config', {
                eq: { key: key }
            });
            
            if (existing && existing.length > 0) {
                await this._update('quantum_ecosystem_config', key, data);
            } else {
                data.created_at = new Date().toISOString();
                await this._insert('quantum_ecosystem_config', data);
            }
        } catch (error) {
            console.error('Error updating config:', error);
            throw error;
        }
    }

    // ==================== OBTENER CONFIGURACIÓN ====================
    
    getConfig(key) {
        const localKey = this._getLocalKey(key);
        const value = localStorage.getItem(localKey);
        if (value) {
            try { 
                const parsed = JSON.parse(value);
                // 🔧 Si es founder_password, asegurar que sea string
                if (key === 'founder_password') {
                    return String(parsed);
                }
                return parsed; 
            } catch(e) { 
                // 🔧 Si es founder_password, asegurar que sea string
                if (key === 'founder_password') {
                    return String(value);
                }
                return value; 
            }
        }
        return null;
    }

    setConfig(key, value) {
        const localKey = this._getLocalKey(key);
        
        // 🔧 FORZAR founder_password como string
        if (key === 'founder_password') {
            value = String(value);
            localStorage.setItem(localKey, value);
        } else {
            localStorage.setItem(localKey, typeof value === 'string' ? value : JSON.stringify(value));
        }
        localStorage.setItem(localKey + '_timestamp', new Date().toISOString());
        
        if (this.isReady) {
            setTimeout(() => this._syncConfig(key, localKey), 500);
        }
    }

    _getLocalKey(cloudKey) {
        const map = {
            'colab_url': 'qcol_colab_url',
            'ai_config': 'qcol_ai',
            'github_config': 'qcol_gh',
            'deepseek_config': 'qcol_mistral',
            'system_config': 'qcol_sys',
            'platform_config': 'qcol_cfg',
            'monitor_config': 'qcol_monitor_cfg',
            'founder_password': 'qcol_fp'  // ✅ NUEVO
        };
        return map[cloudKey] || cloudKey;
    }

    setUser(user) {
        this.currentUser = user;
    }

    destroy() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }
}

export default QcolConfigSync;