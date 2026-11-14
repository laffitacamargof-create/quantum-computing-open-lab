# Nexus — conectores del ecosistema

Nexus es el módulo donde cada usuario guarda **sus** conexiones. Todo lo que no es IA del fundador pasa por aquí.

| Pieza | Archivo | Qué hace |
|---|---|---|
| Módulo (interfaz) | `qcol-nexus.html` | 3 categorías: API · AI, API · External, Local connectors + lista de la comunidad + aprobación |
| Núcleo | `nexus-core.js` | Vault (AES‑GCM local), políticas ONCE/ALWAYS/OFF, brokers de IA y API, instalador, cliente de comunidad |
| Puente local | `nexus-bridge/nexus_bridge.py` | Programa Python (solo stdlib) que corre en el equipo del usuario: Bluetooth, archivos, procesos, proxy HTTP |
| Base de datos | `nexus-db.sql` | Conectores locales compartidos: `pending → aprobación → published` (modelo Quantum Puzzle) |
| Catálogo | `nexus-catalog.json` | Vacío a propósito: no hay conectores locales en la arquitectura; se crean/instalan desde Nexus |

## Reglas de arquitectura
* **IA**: se elige en el índice (botón 🔌 SOURCES): *IA del fundador* o un conector de IA de Nexus. Si el conector está OFF/no habilitado para la herramienta y existe IA del fundador, se usa la del fundador.
* **Resto de APIs**: cada módulo tiene un *espacio* (slot) y lee de 🔌 SOURCES si usa el valor del fundador o un conector externo de Nexus. Sin respaldo silencioso: si el conector está OFF, la llamada se rechaza.
* **Conectores locales**: no forman parte de la arquitectura. Se crean en Nexus (① interfaz, ② lógica web, ③ lógica local Python), se instalan bajo demanda a través del puente, y los permisos se **declaran en el código**: `@connector.tool("open_lab", allow=["ble.scan"])`. Dos herramientas no pueden declarar el mismo permiso.
* **Compartir**: botón SHARE → pendiente → un fundador/admin lo revisa (🔴 PENDING) → publicado para todos. Lo no compartido queda solo en el dispositivo.

## Cómo hablan los módulos con el shell (`postMessage`)
```js
// IA (fundador o conector Nexus, según elija el usuario)
parent.postMessage({type:'OPENQ_AI_CHAT', id, messages:[{role:'user',content:'hola'}]}, '*');   // → OPENQ_AI_RESULT {id, ok, text|error}

// API propia del módulo
parent.postMessage({type:'OPENQ_API_REGISTER', slot:'quantum', label:'Mi módulo · backend', founder:'https://…'}, '*');
parent.postMessage({type:'OPENQ_GET_API_ROUTES'}, '*');                                          // → OPENQ_API_ROUTES {routes}
parent.postMessage({type:'OPENQ_API_REQUEST', id, slot:'quantum', path:'run', method:'POST', body:{…}}, '*'); // → OPENQ_API_RESULT {id, ok, status, text}
```
Las credenciales nunca salen del Vault de Nexus; el módulo solo recibe la respuesta.

## Puesta en marcha
1. Supabase → SQL Editor → ejecutar `nexus-db.sql` (usa tu función `repo_is_founder`).
2. Subir los archivos a GitHub Pages (ya están en este repo).
3. Usuario con conectores locales: `python nexus-bridge/nexus_bridge.py`, copiar el *Pairing code* en Nexus (chip BRIDGE). Bluetooth: `pip install bleak`.

## Pruebas (`nexus-bridge/tests/`)
`python3 nexus-bridge/tests/test_bridge.py` (puente real) · `test_module.py` (módulo en navegador) · `test_shell.py` (integración en el índice). Requieren Python 3.9+ y Playwright. `tests/stubs/bleak` es un sustituto SOLO de pruebas (no hay radio Bluetooth en CI).

## Seguridad
El puente valida permisos y código (AST estricto para la comunidad) pero **no es un sandbox del sistema operativo**: aprueba solo conectores que hayas revisado. ⚠ `supabase-config.js` no debe contener `supabaseServiceKey`: la clave secreta es pública en este repositorio y hay que **rotarla** en Supabase.
