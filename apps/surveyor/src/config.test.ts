import { describe, expect, it } from 'vitest';
import { importConfigFrom, serveConfigFrom } from './config';

describe('environment configuration', () => {
  it('has no default source host or database, and writes only where told', () => {
    expect(() => importConfigFrom({ ATLAS_DATA_DIR: '/tmp/x' })).toThrow(/SURVEYOR_BASE_URL is required/);
    expect(() => importConfigFrom({ SURVEYOR_BASE_URL: 'http://h/atlas/api' })).toThrow(/ATLAS_DATA_DIR is required/);
    const config = importConfigFrom({ SURVEYOR_BASE_URL: 'http://h:1/atlas/api', ATLAS_DATA_DIR: '/tmp/x' });
    expect(config.surveyorBaseUrl.href).toBe('http://h:1/atlas/api/');
    expect(config.surveyorDbPath).toBeNull();
    expect(config.keepRevisions).toBe(3);
  });

  it('refuses credentials in the source URL and unsafe values', () => {
    expect(() => importConfigFrom({ SURVEYOR_BASE_URL: 'http://user:pw@h/atlas/api', ATLAS_DATA_DIR: '/tmp/x' })).toThrow(/credentials/);
    expect(() => importConfigFrom({ SURVEYOR_BASE_URL: 'file:///etc/passwd', ATLAS_DATA_DIR: '/tmp/x' })).toThrow(/http or https/);
    expect(() => importConfigFrom({ SURVEYOR_BASE_URL: 'http://h/', ATLAS_DATA_DIR: '/tmp/x', ATLAS_KEEP_REVISIONS: '0' })).toThrow(/ATLAS_KEEP_REVISIONS/);
  });

  it('serves on 127.0.0.1:5193 unless told otherwise', () => {
    expect(serveConfigFrom({ ATLAS_DATA_DIR: '/tmp/x' })).toEqual({ dataDir: '/tmp/x', host: '127.0.0.1', port: 5193 });
    expect(serveConfigFrom({ ATLAS_DATA_DIR: '/tmp/x', ATLAS_PORT: '5199' }).port).toBe(5199);
  });
});
