import configparser
import os
import httpx
from pathlib import Path
from urllib.parse import urlsplit


class Settings:
    def __init__(self, env=None, path=None):
        self.env = os.environ if env is None else env
        self.runtime = {}
        self.ini = configparser.ConfigParser(interpolation=None)
        filename = path or self.env.get('CONFIG_FILE') or Path(__file__).resolve().parents[2] / 'configuration.ini'
        if not self.ini.read(filename):
            raise RuntimeError('Configuration file is unavailable')

    def get(self, section, key):
        if key.upper() in self.runtime:
            return self.runtime[key.upper()]
        return self.env.get(key.upper()) or self.ini.get(section, key, fallback='')

    def integer(self, section, key):
        value = int(self.get(section, key))
        if value < 0:
            raise ValueError(f'Invalid configuration: {key}')
        return value

    def secret(self, key):
        return self.runtime.get(key, self.env.get(key, ''))

    def refresh(self):
        base = validate_url(self.get('services', 'settings_service_url'))
        with httpx.Client(timeout=self.integer('timeouts', 'service_ms') / 1000, follow_redirects=False) as client:
            response = client.get(base.rstrip('/') + '/settings/runtime', headers={'x-service-token': self.secret('SERVICE_TOKEN')})
            response.raise_for_status()
            data = response.json()
        if not isinstance(data.get('values'), dict) or any(not isinstance(k,str) or not isinstance(v,str) for k,v in data['values'].items()):
            raise ValueError('Invalid runtime connection configuration')
        self.runtime = data['values']

    def boolean(self, section, key):
        return self.get(section, key).lower() == 'true'


def validate_url(url):
    parsed = urlsplit(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Invalid configured provider URL')
    return url
