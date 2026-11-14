const $ = (i) => document.getElementById(i);
$('le-run').onclick = async () => {
  $('le-msg').textContent = 'running…'; $('le-out').textContent = '';
  try {
    const r = await nexus.call('run_python', { code: $('le-code').value, timeout: 30 });
    $('le-out').textContent = (r.stdout || '') + (r.stderr ? '\n[stderr]\n' + r.stderr : '');
    $('le-msg').textContent = 'exit code ' + r.code;
  } catch (e) { $('le-msg').textContent = e.message; }
};
