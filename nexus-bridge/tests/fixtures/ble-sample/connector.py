# Qubi — link and unlink the Qolour Bluetooth qubit models with the ecosystem.
# This version only finds, links and unlinks devices and lets you inspect what a linked Qubi exposes
# (services / characteristics). Reading, writing and subscriptions are exposed as generic actions so the
# Qubi protocol can be added here once its Bluetooth profile is documented.
from nexus import connector


@connector.tool("open_lab", allow=["ble.scan", "ble.link"])
async def scan(ctx, prefix="Qubi", timeout=4):
    """Nearby Bluetooth devices whose name starts with `prefix` (empty prefix = all devices)."""
    return await ctx.ble.scan(prefix=prefix, timeout=timeout)


@connector.tool("open_lab", allow=["ble.scan", "ble.link"])
async def link(ctx, address):
    """Connect to a device and keep it linked. Returns its services and characteristics."""
    services = await ctx.ble.link(address=address)
    await ctx.emit("linked", {"address": address})
    return {"address": address, "services": services}


@connector.tool("open_lab", allow=["ble.scan", "ble.link"])
async def unlink(ctx, address):
    await ctx.ble.unlink(address=address)
    await ctx.emit("unlinked", {"address": address})
    return {"address": address}


@connector.tool("open_lab", allow=["ble.scan", "ble.link"])
async def linked(ctx):
    return await ctx.ble.linked()


@connector.tool("open_lab", allow=["ble.scan", "ble.link"])
async def services(ctx, address):
    return await ctx.ble.services(address=address)


@connector.tool("notebook", allow=["ble.read", "ble.notify"])
async def read(ctx, address, char):
    """Read one characteristic of a linked device."""
    return await ctx.ble.read(address=address, char=char)


@connector.tool("notebook", allow=["ble.read", "ble.notify"])
async def subscribe(ctx, address, char):
    """Receive notifications of one characteristic as 'ble.notify' events."""
    return await ctx.ble.notify(address=address, char=char)


@connector.tool("notebook", allow=["ble.read", "ble.notify"])
async def unsubscribe(ctx, address, char):
    return await ctx.ble.unnotify(address=address, char=char)
