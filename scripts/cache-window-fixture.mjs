import { access, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const target = '.local/cache-window-fixture.mp4';
try {
  await access(target);
} catch {
  await mkdir('.local', { recursive: true });
  await promisify(execFile)(
    process.env.VS_FFMPEG || 'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=24',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=550:sample_rate=48000',
      '-t',
      '12',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-threads',
      '1',
      '-filter_threads',
      '1',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '24',
      '-keyint_min',
      '24',
      '-sc_threshold',
      '0',
      '-b:v',
      '3M',
      '-minrate',
      '3M',
      '-maxrate',
      '3M',
      '-bufsize',
      '3M',
      '-x264-params',
      'nal-hrd=cbr:force-cfr=1',
      '-c:a',
      'aac',
      '-b:a',
      '64k',
      '-movflags',
      '+faststart',
      target,
    ],
    { windowsHide: true },
  );
}
