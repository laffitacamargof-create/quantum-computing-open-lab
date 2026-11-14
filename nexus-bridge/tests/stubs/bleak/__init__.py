# TEST-ONLY stand-in for the `bleak` library (there is no Bluetooth radio in this sandbox).
import asyncio
class _Dev:
    def __init__(s, a, n): s.address = a; s.name = n
class _Adv:
    def __init__(s, r): s.rssi = r; s.local_name = None
class BleakScanner:
    @staticmethod
    async def discover(timeout=5.0, return_adv=False):
        await asyncio.sleep(0.05)
        d = {"AA:01": (_Dev("AA:01", "Qubi-One"), _Adv(-50)), "AA:02": (_Dev("AA:02", "Qubi-Two"), _Adv(-70)), "BB:09": (_Dev("BB:09", "Headphones"), _Adv(-40))}
        return d if return_adv else [v[0] for v in d.values()]
class _Ch:
    def __init__(s, u, p): s.uuid = u; s.properties = p
class _Svc:
    def __init__(s, u, c): s.uuid = u; s.characteristics = c
class BleakClient:
    def __init__(s, address, disconnected_callback=None): s.address = address; s.is_connected = False; s._cb = disconnected_callback; s._n = {}
    async def connect(s, timeout=10): await asyncio.sleep(0.02); s.is_connected = True
    async def disconnect(s): s.is_connected = False
    @property
    def services(s): return [_Svc("0000aaaa", [_Ch("0000bbbb", ["read", "notify"])])]
    async def read_gatt_char(s, c): return bytearray([1, 2, 255])
    async def write_gatt_char(s, c, d, response=True): return None
    async def start_notify(s, c, cb):
        loop = asyncio.get_running_loop(); loop.call_later(0.1, cb, c, bytearray([7, 8]))
    async def stop_notify(s, c): return None
