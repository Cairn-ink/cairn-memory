// Native probes must enter a fresh network namespace before any native exec.
import { spawnSync, execFileSync } from 'node:child_process';
import { readlinkSync } from 'node:fs';

export function isolateProbe() {
  const option = process.argv.indexOf('--probe-parent-netns');
  const current = readlinkSync('/proc/self/ns/net');
  if (option < 0) {
    const child = spawnSync('unshare', ['-rn', process.execPath, ...process.argv.slice(1),
      '--probe-parent-netns', current], { stdio: 'inherit',
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' } });
    if (child.error) throw child.error;
    if (child.signal) throw new Error('isolation_child_signal: ' + child.signal);
    process.exit(child.status ?? 1);
  }
  if (process.argv[option + 1] === current) throw new Error('network_namespace_unchanged');
  execFileSync('/usr/sbin/ip', ['link', 'set', 'lo', 'up']);
  const links = JSON.parse(execFileSync('/usr/sbin/ip', ['-j', 'address'], { encoding: 'utf8' }));
  const routes = ['-4', '-6'].flatMap(family => JSON.parse(execFileSync('/usr/sbin/ip',
    [family, '-j', 'route', 'show', 'table', 'all'], { encoding: 'utf8' })));
  // Query netlink in this namespace; an inherited sysfs mount describes the host.
  if (links.length !== 1 ||
      links[0].ifname !== 'lo' || !links[0].flags.includes('UP') ||
      !links[0].addr_info.some(row => row.local === '127.0.0.1') ||
      routes.some(row => row.dev !== 'lo')) throw new Error('loopback_isolation_unverified');
  return { networkNamespace: 'fresh', interfaces: ['lo'], loopbackUp: true, externalRoutes: 0 };
}
