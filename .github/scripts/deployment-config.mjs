const fields = [
  'project',
  'customer_id',
  'stage',
  'cloud',
  'default_location',
  'resource_group_name',
  'public_cloud_flag',
  'dns_zone_name',
  'dns_zone_resource_group_name',
  'state_storage_account_name',
  'state_container_name',
  'state_resource_group_name',
  'state_bucket_name',
  'state_region',
];

const requiredCommon = ['project', 'customer_id', 'stage', 'cloud', 'default_location', 'public_cloud_flag'];
const requiredAzure = [
  'resource_group_name',
  'dns_zone_name',
  'dns_zone_resource_group_name',
  'state_storage_account_name',
  'state_container_name',
  'state_resource_group_name',
];
const requiredAws = ['state_bucket_name', 'state_region'];
const fieldSet = new Set(fields);

function isMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAbsent(value) {
  return value === null || value === undefined || (typeof value === 'string' && !/[\r\n]/.test(value) && value.trim() === '');
}

function validateValue(field, value, source) {
  if (typeof value === 'string' && /[\r\n]/.test(value)) {
    throw new Error(`${source}.${field} must not contain newlines (unsafe for workflow environment data)`);
  }
  if (isAbsent(value)) return undefined;
  if (field === 'public_cloud_flag') {
    if (value === true || value === false || value === 'true' || value === 'false') {
      return String(value);
    }
    throw new Error(`${source}.${field} must be a boolean or 'true'/'false' string`);
  }
  if (typeof value !== 'string') {
    throw new Error(`${source}.${field} must be a string`);
  }
  return value;
}

function readDeployment(mapping, source, label) {
  if (mapping === null || mapping === undefined) return {};
  if (!isMapping(mapping)) throw new Error(`${source}: ${label} must be a mapping`);
  const values = {};
  for (const [field, rawValue] of Object.entries(mapping)) {
    if (!fieldSet.has(field)) throw new Error(`${source}: unknown ${label} key '${field}'`);
    const value = validateValue(field, rawValue, `${source}: ${label}`);
    if (value !== undefined) values[field] = value;
  }
  return values;
}

// Later selected documents win; missing fields fall back to GitHub variables.
export function resolveDeploymentContext({ documents, variables = {}, skipCloudValidation = false }) {
  if (!Array.isArray(documents)) throw new Error('documents must be an array of config documents');
  if (!isMapping(variables)) throw new Error('variables must be a mapping of GitHub variables');

  const configured = {};
  for (const [index, document] of documents.entries()) {
    if (!isMapping(document)) throw new Error(`documents[${index}] must be a config document`);
    const source = document.sourceFile || `documents[${index}]`;
    const selected = readDeployment(document.deployment, source, 'deployment');
    Object.assign(configured, selected);
  }

  const result = {};
  for (const field of fields) {
    const variableName = field.toUpperCase();
    if (configured[field] !== undefined) {
      result[variableName] = configured[field];
      continue;
    }
    const rawVariable = field === 'project' && !isAbsent(variables.project)
      ? variables.project
      : variables[variableName];
    result[variableName] = validateValue(field, rawVariable, `GitHub variable ${variableName}`) ?? '';
  }

  const required = [...requiredCommon];
  const cloud = result.CLOUD.toLowerCase();
  if (cloud && !['azure', 'aws'].includes(cloud)) {
    throw new Error(`deployment.cloud / GitHub variable CLOUD must be 'azure' or 'aws' (received '${result.CLOUD}')`);
  }
  result.CLOUD = cloud;
  if (!skipCloudValidation) required.push(...(cloud === 'aws' ? requiredAws : cloud === 'azure' ? requiredAzure : []));
  for (const field of required) {
    if (!result[field.toUpperCase()]) {
      throw new Error(`Missing deployment.${field}; set it in deployment or GitHub variable ${field.toUpperCase()}`);
    }
  }

  if (cloud === 'azure' && result.STATE_STORAGE_ACCOUNT_NAME) {
    const name = result.STATE_STORAGE_ACCOUNT_NAME.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (name.length < 3 || name.length > 24) {
      throw new Error(`deployment.state_storage_account_name / GitHub variable STATE_STORAGE_ACCOUNT_NAME must normalize to 3-24 lowercase letters or digits (got '${name}')`);
    }
    result.STATE_STORAGE_ACCOUNT_NAME = name;
  }
  return result;
}
