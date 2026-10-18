import type { Member } from '../shared/protocol';
import { RTT_TTL } from '../shared/latency';

type Report = Pick<Member, 'id' | 'rtt' | 'rttAgeMs'>;
export class Latencies {
  private samples = new Map<string, Report & { received: number }>();
  clear() {
    this.samples.clear();
  }
  update(reports: Report[], now: number) {
    this.samples.clear();
    for (const sample of reports) this.samples.set(sample.id, { ...sample, received: now });
  }
  read(id: string, now: number) {
    const sample = this.samples.get(id);
    const age =
      sample?.rttAgeMs === undefined
        ? Infinity
        : sample.rttAgeMs + Math.max(0, now - sample.received);
    const rtt = sample?.rtt;
    const fresh = typeof rtt === 'number' && Number.isFinite(rtt) && rtt >= 0 && age < RTT_TTL;
    return {
      rtt: fresh ? rtt : null,
      label: fresh ? (rtt < 1 ? '<1 ms' : `${Math.round(rtt)} ms`) : '—',
      title: fresh
        ? `到房间服务器的往返延迟；${Math.floor(age / 1000)} 秒前采样，不代表画面缓冲延迟`
        : sample?.rttAgeMs !== undefined && age >= RTT_TTL
          ? '延迟样本已过期，等待重新测量'
          : '等待服务器测量往返延迟',
    };
  }
}
