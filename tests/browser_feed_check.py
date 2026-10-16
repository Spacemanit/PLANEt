"""Checks deployment error messages and retained observations using API fixtures."""
import json
import os
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

out = Path(__file__).resolve().parent.parent / 'test-results'
out.mkdir(exist_ok=True)
now = int(time.time())
row = ['abcdef', 'IGO214', 'India', now, now, 77.1, 23.1, 10500, False, 230, 133, 0, None, None, '2000', False, 0, 4]
payload = {
    'states': [row], 'time': now, 'fetchedAt': now * 1000, 'remaining': 3900,
    'authMode': 'authenticated', 'upstreamStatus': 200, 'issue': None,
    'diagnostic': None, 'nextPollMs': 60000, 'retryAt': None, 'stale': False,
}

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width': 1200, 'height': 1000}, reduced_motion='reduce')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def serve(route):
        route.fulfill(status=200 if payload['fetchedAt'] else 503, content_type='application/json', body=json.dumps(payload))

    page.route('**/api/aircraft*', serve)
    page.goto(os.environ.get('PLANET_BASE_URL', 'http://127.0.0.1:3000'), wait_until='networkidle')
    expect(page.get_by_role('heading', name='Planes everywhere 1')).to_be_visible()
    # A new failed request must not remove the saved aircraft or show the old HTTP 200.
    payload.update(states=[], fetchedAt=None, upstreamStatus=None,
                   issue='The server connection to OpenSky’s aircraft service timed out before an HTTP response. Retrying automatically.',
                   diagnostic={'stage': 'aircraft', 'code': 'CONNECTION_TIMEOUT', 'networkCode': 'UND_ERR_CONNECT_TIMEOUT', 'retryable': True})
    page.reload(wait_until='networkidle')
    expect(page.get_by_role('heading', name='Planes everywhere 1')).to_be_visible()
    page.get_by_role('button', name='Open feed status').click()
    expect(page.get_by_text('No HTTP response received', exact=True)).to_be_visible()
    expect(page.get_by_text('HTTP 200', exact=True)).to_have_count(0)
    expect(page.get_by_text('OpenSky aircraft feed', exact=False)).to_be_visible()
    expect(page.get_by_text('UND_ERR_CONNECT_TIMEOUT', exact=False)).to_be_visible()
    expect(page.get_by_text('About hosted connections', exact=True)).to_be_visible()
    page.screenshot(path=str(out / 'feed-hosting-timeout.png'), full_page=True)
    page.get_by_role('button', name='Close dialog').click()
    payload.update(authMode='unconfigured', issue='Live tracking needs deployment settings. Add OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET in Vercel’s Production environment variables, then redeploy.',
                   diagnostic={'stage': 'configuration', 'code': 'MISSING_CREDENTIALS', 'retryable': False})
    page.reload(wait_until='networkidle')
    page.get_by_role('button', name='Open feed status').click()
    expect(page.get_by_text('Live tracking needs setup', exact=True)).to_be_visible()
    expect(page.get_by_text('Deployment credentials missing', exact=True)).to_be_visible()
    expect(page.get_by_text('About hosted connections', exact=True)).to_have_count(0)
    page.screenshot(path=str(out / 'feed-missing-settings.png'), full_page=True)
    page.get_by_role('button', name='Close dialog').click()
    expect(page.get_by_text('Deployment setup needed', exact=True)).to_be_visible()
    page.get_by_role('button', name='Sample mode', exact=True).click()
    expect(page.get_by_role('heading', name='Planes everywhere 192')).to_be_visible()
    page.get_by_role('button', name='Open feed status').click()
    expect(page.get_by_text('You’re in sample mode', exact=True)).to_be_visible()
    expect(page.get_by_text('Deployment credentials missing', exact=True)).to_have_count(0)
    assert not errors, '\n'.join(errors)
    browser.close()
    print('PASS: missing Vercel settings, upstream timeout, retained aircraft, cleared HTTP status, and explicit sample mode')
