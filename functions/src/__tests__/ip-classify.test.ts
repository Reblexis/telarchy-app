import { classifyRow } from '../lib/ip-classify';

describe('classifyRow (person vs server/bot by IP type)', () => {
  it('hosting/datacenter IP is a server', () => {
    expect(classifyRow({ status: 'success', hosting: true, org: 'Google Cloud' }).kind).toBe('server');
  });
  it('proxy/VPN IP is a proxy', () => {
    expect(classifyRow({ status: 'success', proxy: true, org: 'Some VPN' }).kind).toBe('proxy');
  });
  it('residential/mobile ISP is a person', () => {
    expect(classifyRow({ status: 'success', mobile: true, org: 'T Mobile Czech xDSL' }).kind).toBe('person');
  });
  it('hosting wins over proxy', () => {
    expect(classifyRow({ status: 'success', hosting: true, proxy: true }).kind).toBe('server');
  });
  it('failed lookup is unknown', () => {
    expect(classifyRow({ status: 'fail' }).kind).toBe('unknown');
  });
  it('carries the org name (truncated)', () => {
    expect(classifyRow({ status: 'success', org: 'Alibaba' }).org).toBe('Alibaba');
  });
});
