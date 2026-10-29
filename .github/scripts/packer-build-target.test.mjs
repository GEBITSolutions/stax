import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  SCAN_HOOK_MARKER,
  assembleVarFile,
  assertScanTemplateContract,
  azureImageRef,
  costNote,
  declaredPackerVariables,
  evaluateGalleryReadiness,
  galleryFieldsFromStack,
  hetznerImageRef,
  manifestSnapshotId,
  materializeScan,
  normalizeAzureRegion,
  resolveBuildTarget,
  resolveHetzner,
  resolveScan,
  snapshotsToDelete,
  staxVariables,
  transferVariableMap,
  waitForGalleryReplication,
} from './packer-build-target.mjs';

const sha = '0123456789abcdef0123456789abcdef01234567';

test('omitted build_target stays azure and aliases fold into the gallery object', () => {
  assert.equal(resolveBuildTarget({ type: 'packer' }), 'azure');
  const resolved = galleryFieldsFromStack({
    gallery_name: 'corp_gallery',
    image_version: '1.2.3',
    azure: { image_version: '1.2.3', image_definition_name: 'ubuntu2404' },
  });
  assert.deepEqual(resolved.fields, {
    gallery_name: 'corp_gallery',
    image_version: '1.2.3',
    image_definition_name: 'ubuntu2404',
  });
  assert.throws(() => galleryFieldsFromStack({ gallery_name: 'a', azure: { gallery_name: 'b' } }), /conflicts/);
});

test('legacy var files stay byte-identical when nothing new is declared', () => {
  const existing = {
    image_resource_group_name: 'rg-images',
    gallery_name: 'corp_gallery',
    image_definition_name: 'ubuntu2404',
    image_version: '1.2.3',
    target_regions: ['westeurope'],
  };
  const assembled = assembleVarFile({
    existing,
    targetFields: {},
    stax: { stax_build_target: 'azure', stax_git_sha: sha },
    declared: new Set(),
  });
  assert.equal(assembled.changed, false);
  assert.deepEqual(assembled.vars, existing);
});

test('declared stax variables are injected and input conflicts are rejected', () => {
  const assembled = assembleVarFile({
    existing: { gallery_name: 'corp_gallery' },
    targetFields: { gallery_name: 'corp_gallery', image_version: '1.2.3' },
    stax: { stax_build_target: 'azure', stax_image_version: '1.2.3', stax_git_sha: sha },
    declared: new Set(['stax_build_target', 'stax_image_version']),
  });
  assert.deepEqual(assembled.added, ['image_version', 'stax_build_target', 'stax_image_version']);
  assert.equal(assembled.vars.stax_git_sha, undefined);
  assert.throws(
    () => assembleVarFile({
      existing: { gallery_name: 'from-input' },
      targetFields: { gallery_name: 'from-azure' },
      stax: {},
      declared: new Set(),
    }),
    /conflicts/,
  );
});

test('hetzner labels keep the retention selector even when the user sets those keys', () => {
  const resolved = resolveHetzner({
    id: 'golden-hetzner',
    hetzner: {
      location: 'fsn1',
      server_type: 'cax11',
      snapshot_name: 'personal-assistant-golden',
      snapshot_labels: { 'personal-assistant': 'true', role: 'golden', managed_by: 'someone-else' },
    },
  }, { gitSha: sha, environment: 'dev' });
  assert.equal(resolved.keepLast, 3);
  assert.equal(resolved.fields.snapshot_labels.managed_by, 'stax');
  assert.equal(resolved.fields.snapshot_labels.stax_stack_id, 'golden-hetzner');
  assert.equal(resolved.fields.snapshot_labels['personal-assistant'], 'true');
  assert.equal(resolved.fields.server_type, 'cax11');
  assert.match(costNote('cax11', 3), /€0\.01 per hour/);
});

test('retention keeps the newest matches and never deletes the snapshot just built', () => {
  const images = [1, 2, 3, 4].map((id) => ({
    id,
    type: 'snapshot',
    created: `2026-10-0${id}T00:00:00Z`,
    labels: { managed_by: 'stax', stax_stack_id: 'golden-hetzner', stax_env: 'dev', stax_build_target: 'hetzner', role: 'golden' },
  }));
  images.push({ id: 9, type: 'snapshot', created: '2026-10-09T00:00:00Z', labels: { managed_by: 'other' } });
  const selector = { managed_by: 'stax', stax_stack_id: 'golden-hetzner', stax_env: 'dev', stax_build_target: 'hetzner' };
  assert.deepEqual(snapshotsToDelete({ images, selector, keepLast: 3, protectIds: ['4'] }), ['1']);
  assert.deepEqual(snapshotsToDelete({ images, selector, keepLast: 0, protectIds: ['4'] }), ['1', '2', '3']);
  assert.deepEqual(snapshotsToDelete({ images, selector, keepLast: 0 }), ['1', '2', '3', '4']);
});

test('manifest ids and normalized outputs', () => {
  assert.equal(manifestSnapshotId({ builds: [{ artifact_id: 'hcloud.personal_assistant:42' }, { artifact_id: '99' }] }), '99');
  assert.equal(hetznerImageRef('99'), 'hcloud:snapshot:99');
  assert.equal(azureImageRef({ resourceGroup: 'rg-images', gallery: 'corp_gallery', definition: 'ubuntu2404', version: '1.2.3' }), 'azure:gallery:rg-images/corp_gallery/ubuntu2404/1.2.3');
  assert.deepEqual(
    transferVariableMap('golden-hetzner', ['image_id', 'labels', 'missing'], { image_id: '99', labels: '{"role":"golden"}', image_ref: '' }),
    { GOLDEN_HETZNER__IMAGE_ID: '99', GOLDEN_HETZNER__LABELS: '{"role":"golden"}' },
  );
  assert.throws(() => manifestSnapshotId({ builds: [] }), /manifest/);
});

test('template variable discovery ignores the plugin cache', () => {
  const root = mkdtempSync(join(tmpdir(), 'packer-vars-'));
  mkdirSync(join(root, '.packer'));
  writeFileSync(join(root, 'image.pkr.hcl'), 'variable "location" {\n  type = string\n}\nvariable "stax_git_sha" {\n  type = string\n}\n');
  writeFileSync(join(root, '.packer', 'ignore.pkr.hcl'), 'variable "token" {\n  type = string\n}\n');
  assert.deepEqual([...declaredPackerVariables(root)].sort(), ['location', 'stax_git_sha']);
});

test('resolveScan stays disabled when omitted and fills defaults when enabled', () => {
  assert.deepEqual(resolveScan({ type: 'packer' }), { enabled: false, config: null });
  assert.throws(() => resolveScan({ scan: {} }), /at least one/);
  assert.throws(() => resolveScan({ scan: { trivy: { severity: 'high' } } }), /severity/);
  const resolved = resolveScan({
    scan: {
      trivy: {},
      lynis: { min_hardening_index: 65 },
      goss: { spec: 'goss.yaml' },
    },
  });
  assert.equal(resolved.enabled, true);
  assert.deepEqual(resolved.config, {
    trivy: { severity: 'HIGH,CRITICAL', scanners: ['vuln'] },
    lynis: { min_hardening_index: 65 },
    goss: { spec: 'goss.yaml' },
  });
});

test('staxVariables only adds stax_scan_enabled when scans are on', () => {
  const off = staxVariables({
    buildTarget: 'hetzner',
    stackId: 'img',
    environment: 'dev',
    gitSha: sha,
    version: `0.0.0+${sha}`,
  });
  assert.equal(Object.hasOwn(off, 'stax_scan_enabled'), false);
  const on = staxVariables({
    buildTarget: 'hetzner',
    stackId: 'img',
    environment: 'dev',
    gitSha: sha,
    version: `0.0.0+${sha}`,
    scanEnabled: true,
  });
  assert.equal(on.stax_scan_enabled, true);
});

test('assertScanTemplateContract requires the variable and the hook marker', () => {
  const root = mkdtempSync(join(tmpdir(), 'stax-scan-'));
  writeFileSync(
    join(root, 'bare.pkr.hcl'),
    'variable "location" { type = string }\nbuild { sources = [] }\n',
  );
  assert.throws(() => assertScanTemplateContract(root), /stax_scan_enabled/);

  const root2 = mkdtempSync(join(tmpdir(), 'stax-scan-'));
  writeFileSync(
    join(root2, 'partial.pkr.hcl'),
    'variable "stax_scan_enabled" { type = bool }\nbuild { sources = [] }\n',
  );
  assert.throws(() => assertScanTemplateContract(root2), new RegExp(SCAN_HOOK_MARKER.replace(/\./g, '\\.')));
  writeFileSync(
    join(root2, 'hook.pkr.hcl'),
    `variable "stax_scan_enabled" { type = bool }\nbuild {\n  sources = []\n  provisioner "shell" {\n    script = "\${path.root}/${SCAN_HOOK_MARKER}"\n  }\n}\n`,
  );
  assert.doesNotThrow(() => assertScanTemplateContract(root2));
});

test('materializeScan embeds config and goss spec into run.sh', () => {
  const root = mkdtempSync(join(tmpdir(), 'stax-scan-mat-'));
  writeFileSync(join(root, 'goss.yaml'), 'file:\n  /etc/os-release:\n    exists: true\n');
  writeFileSync(
    join(root, 'image.pkr.hcl'),
    `variable "stax_scan_enabled" { type = bool }\nbuild {\n  provisioner "shell" { script = "\${path.root}/${SCAN_HOOK_MARKER}" }\n}\n`,
  );
  const scriptsRoot = join(dirname(fileURLToPath(import.meta.url)), 'packer-scan');
  const scan = resolveScan({
    scan: { trivy: { severity: 'CRITICAL' }, goss: { spec: 'goss.yaml' } },
  });
  const result = materializeScan({ packerDirectory: root, scan, scriptsRoot });
  assert.equal(result.written, true);
  const generated = readFileSync(join(root, '.stax/scan/run.sh'), 'utf8');
  assert.match(generated, /STAX_EMBEDDED_CONFIG=/);
  assert.match(generated, /CRITICAL/);
  assert.match(generated, /STAX_EMBEDDED_GOSS_SPEC=/);
  assert.match(generated, /\/etc\/os-release/);
  const disabled = materializeScan({ packerDirectory: root, scan: { enabled: false, config: null } });
  assert.equal(disabled.written, false);
  assert.match(readFileSync(join(root, '.stax/scan/run.sh'), 'utf8'), /scan hooks disabled/);
});

test('normalizeAzureRegion collapses case separators', () => {
  assert.equal(normalizeAzureRegion('West Europe'), 'westeurope');
  assert.equal(normalizeAzureRegion('west_europe'), 'westeurope');
  assert.equal(normalizeAzureRegion('West-Europe'), 'westeurope');
});

test('evaluateGalleryReadiness matches the previous workflow poll rules', () => {
  const version = '1.2.3';
  const imageId = `/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/galleries/g/images/d/versions/${version}`;
  const ready = evaluateGalleryReadiness({
    id: imageId,
    provisioningState: 'Succeeded',
    tags: { built_by: 'stax' },
    replicationStatus: {
      summary: [
        { region: 'West Europe', state: 'Completed' },
        { region: 'northeurope', state: 'Completed' },
      ],
    },
  }, ['westeurope', 'North Europe']);
  assert.equal(ready.state, 'ready');
  assert.equal(ready.imageId, imageId);
  assert.deepEqual(ready.labels, { built_by: 'stax' });

  const pending = evaluateGalleryReadiness({
    id: imageId,
    provisioningState: 'Creating',
    replicationStatus: { summary: [{ region: 'westeurope', state: 'Replicating' }] },
  }, ['westeurope']);
  assert.equal(pending.state, 'pending');

  const failedProv = evaluateGalleryReadiness({
    provisioningState: 'Failed',
    replicationStatus: { summary: [] },
  }, ['westeurope']);
  assert.equal(failedProv.state, 'failed');

  const failedRegion = evaluateGalleryReadiness({
    provisioningState: 'Succeeded',
    replicationStatus: { summary: [{ region: 'westeurope', state: 'Failed' }] },
  }, ['westeurope']);
  assert.equal(failedRegion.state, 'failed');

  const ambiguous = evaluateGalleryReadiness({
    provisioningState: 'Succeeded',
    replicationStatus: {
      summary: [
        { region: 'West Europe', state: 'Completed' },
        { region: 'westeurope', state: 'Completed' },
      ],
    },
  }, ['westeurope']);
  assert.equal(ambiguous.state, 'failed');
});

test('waitForGalleryReplication polls until ready and rejects bad ids', async () => {
  const version = '9.9.9';
  const imageId = `/subscriptions/sub/resourceGroups/rg-images/providers/Microsoft.Compute/galleries/corp/images/ubuntu/versions/${version}`;
  const statuses = [
    { provisioningState: 'Creating', replicationStatus: { summary: [{ region: 'westeurope', state: 'Replicating' }] } },
    {
      id: imageId,
      provisioningState: 'Succeeded',
      tags: { role: 'golden' },
      replicationStatus: { summary: [{ region: 'westeurope', state: 'Completed' }] },
    },
  ];
  let sleeps = 0;
  const result = await waitForGalleryReplication({
    resourceGroup: 'rg-images',
    gallery: 'corp',
    definition: 'ubuntu',
    version,
    targetRegions: ['westeurope'],
    waitCreated: async () => {},
    showVersion: async () => statuses.shift(),
    sleep: async () => { sleeps += 1; },
    maxAttempts: 5,
    intervalMs: 1,
  });
  assert.equal(sleeps, 1);
  assert.equal(result.image_id, imageId);
  assert.equal(result.image_ref, 'azure:gallery:rg-images/corp/ubuntu/9.9.9');
  assert.equal(result.build_target, 'azure');
  assert.deepEqual(result.labels, { role: 'golden' });

  await assert.rejects(
    () => waitForGalleryReplication({
      resourceGroup: 'rg-images',
      gallery: 'corp',
      definition: 'ubuntu',
      version,
      targetRegions: ['westeurope'],
      showVersion: async () => ({
        id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/galleries/g/images/d/versions/other',
        provisioningState: 'Succeeded',
        replicationStatus: { summary: [{ region: 'westeurope', state: 'Completed' }] },
      }),
      maxAttempts: 1,
      intervalMs: 1,
    }),
    /readiness/,
  );
});
