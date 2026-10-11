/** Official Model Studio endpoints only. Never allow arbitrary *.aliyuncs.com. */
const HOSTS = new Set([
  'dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com', 'dashscope-us.aliyuncs.com',
  'cn-hongkong.dashscope.aliyuncs.com', 'coding-intl.dashscope.aliyuncs.com', 'coding.dashscope.aliyuncs.com',
]);
/** @param {string} host */
export function isQwenCloudHost(host) {
  const value = String(host || '').toLowerCase();
  return HOSTS.has(value) || /^[a-z0-9][a-z0-9-]{0,62}\.(?:ap-southeast-1|cn-beijing|cn-hongkong|ap-northeast-1|eu-central-1|us-east-1)\.maas\.aliyuncs\.com$/.test(value);
}
