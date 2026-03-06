import path from 'path';

export interface TokenOptions {
  limit?: number;
  maxlength?: number;
  case?: 'lower' | 'upper' | 'none';
  delimiter?: string;
  unsafe?: boolean;
  format?: string;
  single_letter?: boolean;
  pad_left?: number;
  sort?: {
    attribute?: 'name' | 'length';
    order?: 'asc' | 'desc';
  };
}

export interface TokenDefaults {
  [token: string]: TokenOptions | undefined;
}

export interface FileNameTokens {
  id?: string | number;
  md5?: string;
  extension?: string;
  width?: number;
  height?: number;
  rating?: string;
  score?: number;
  site?: string;
  artist?: string;
  character?: string;
  copyright?: string;
  date?: string;
  tags?: string;
  source?: string;
}

/**
 * 解析token字符串，提取token名称和选项
 * 支持格式: {token}, {token:option=value}, {token:option1=value1,option2=value2}
 */
export function parseToken(tokenStr: string): {
  token: string;
  options: TokenOptions;
} {
  // 移除花括号
  const content = tokenStr.slice(1, -1);

  // 查找选项分隔符（冒号）
  const colonIndex = content.indexOf(':');

  if (colonIndex === -1) {
    // 没有选项
    return {
      token: content.trim(),
      options: {}
    };
  }

  // 分离token名称和选项字符串
  const token = content.substring(0, colonIndex).trim();
  const optionsStr = content.substring(colonIndex + 1).trim();

  // 解析选项
  const options: TokenOptions = {};

  // 解析键值对（用逗号分隔）
  const pairs = optionsStr.split(',');

  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex === -1) continue; // 没有等号，跳过

    const key = pair.substring(0, eqIndex).trim();
    const value = pair.substring(eqIndex + 1).trim();

    // 解析不同类型的值
    if (key === 'limit' || key === 'maxlength' || key === 'pad_left') {
      // 数字类型
      const numValue = parseInt(value, 10);
      if (!isNaN(numValue)) {
        (options as any)[key] = numValue;
      }
    } else if (key === 'single_letter' || key === 'unsafe') {
      // 布尔类型
      (options as any)[key] = value === 'true';
    } else if (key === 'case' || key === 'delimiter' || key === 'format') {
      // 字符串类型
      (options as any)[key] = value;
    }
  }

  return {
    token,
    options
  };
}

/**
 * 查找模板中的所有token
 */
export function findTokens(template: string): Array<{
  fullMatch: string;
  token: string;
  options: TokenOptions;
}> {
  const tokens: Array<{ fullMatch: string; token: string; options: TokenOptions }> = [];
  const regex = /\{[^}]+\}/g;
  let match;

  while ((match = regex.exec(template)) !== null) {
    const parsed = parseToken(match[0]);
    tokens.push({
      fullMatch: match[0],
      token: parsed.token,
      options: parsed.options
    });
  }

  return tokens;
}

/**
 * 处理token值（应用options）
 */
function processTokenValue(
  value: string,
  tokenName: string,
  tokenOptions?: TokenOptions
): string {
  if (!value || value === '') return '';

  const options = tokenOptions || {};
  let processed = value;

  // 1. 应用大小写转换
  if (options.case) {
    switch (options.case) {
      case 'lower':
        processed = processed.toLowerCase();
        break;
      case 'upper':
        processed = processed.toUpperCase();
        break;
      case 'none':
        // 保持原样
        break;
    }
  }

  // 2. 分割列表（tags等）
  let items: string[] = [processed];
  if (tokenName === 'tags' || tokenName === 'artist' ||
      tokenName === 'character' || tokenName === 'copyright') {
    // 按空格分割
    items = processed.split(/\s+/).filter(item => item.trim() !== '');
  }

  // 3. 限制数量
  if (options.limit && options.limit > 0) {
    items = items.slice(0, options.limit);
  }

  // 4. 排序（如果需要）
  if (options.sort && items.length > 1) {
    items.sort((a, b) => {
      if (options.sort?.attribute === 'length') {
        return options.sort?.order === 'desc'
          ? b.length - a.length
          : a.length - b.length;
      } else {
        // 默认按名称排序
        return options.sort?.order === 'desc'
          ? b.localeCompare(a)
          : a.localeCompare(b);
      }
    });
  }

  // 5. 重新组合
  if (items.length > 1) {
    const delimiter = options.delimiter || '_';
    processed = items.join(delimiter);
  } else {
    processed = items[0] || '';
  }

  // 6. 限制最大长度
  if (options.maxlength && processed.length > options.maxlength) {
    processed = processed.substring(0, options.maxlength);
  }

  // 7. 左侧填充0（仅ID）
  if (options.pad_left && tokenName === 'id' && !isNaN(Number(processed))) {
    processed = processed.padStart(options.pad_left, '0');
  }

  // 8. MD5最大长度限制
  if (options.maxlength && tokenName === 'md5' && processed.length > 32) {
    processed = processed.substring(0, 32);
  }

  // 9. 评分单个字母（s/q/e）
  if (options.single_letter && tokenName === 'rating') {
    processed = processed.charAt(0).toLowerCase();
  }

  // 10. 日期格式化
  if (options.format && tokenName === 'date' && processed) {
    try {
      const date = new Date(processed);
      if (!isNaN(date.getTime())) {
        processed = formatDate(date, options.format);
      }
    } catch (e) {
      // 保持原样
    }
  }

  return processed;
}

/**
 * 格式化日期
 */
function formatDate(date: Date, format: string): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return format
    .replace(/yyyy/g, String(year))
    .replace(/MM/g, month)
    .replace(/dd/g, day)
    .replace(/hh/g, hours)
    .replace(/mm/g, minutes)
    .replace(/ss/g, seconds);
}

/**
 * 生成文件名
 * @param template 文件名模板，如 "{id}_{md5}.{extension}"
 * @param metadata 文件元数据
 * @param tokenDefaults Token默认选项（可选，用于处理token）
 */
export function generateFileName(
  template: string,
  metadata: FileNameTokens,
  tokenDefaults?: TokenDefaults
): string {
  let result = template;

  // 查找模板中的所有token（包括带选项的）
  const tokens = findTokens(template);

  // 替换每个token
  for (const { fullMatch, token, options } of tokens) {
    // 合并选项：模板中的选项优先于默认选项
    const mergedOptions = {
      ...tokenDefaults?.[token],
      ...options
    };

    // 获取token的值
    const value = (metadata as any)[token];

    if (value !== undefined && value !== null) {
      // 处理token值
      const processedValue = processTokenValue(
        String(value),
        token,
        mergedOptions
      );
      result = result.replace(fullMatch, processedValue);
    } else {
      // token没有值，替换为空字符串
      result = result.replace(fullMatch, '');
    }
  }

  // 移除未替换的标记（不应该有）
  result = result.replace(/\{[^}]+\}/g, '');

  // 清理非法字符（如果unsafe为false或undefined）
  result = sanitizeFileName(result);

  // 验证文件名长度不超过 Windows MAX_PATH（260 字符，减去目录预留空间）
  const MAX_FILENAME_LENGTH = 200;
  if (result.length > MAX_FILENAME_LENGTH) {
    const ext = path.extname(result);
    const nameWithoutExt = result.slice(0, result.length - ext.length);
    result = nameWithoutExt.slice(0, MAX_FILENAME_LENGTH - ext.length) + ext;
    console.warn(`[filenameGenerator] 文件名过长，已截断至 ${result.length} 字符: ${result}`);
  }

  return result;
}

/**
 * 清理文件名中的非法字符
 * @param fileName 文件名
 * @param unsafe 是否保留非法字符（true=保留，false=替换为_）
 */
export function sanitizeFileName(fileName: string, unsafe: boolean = false): string {
  // 如果unsafe为true，跳过清理
  if (unsafe) {
    return fileName.trim();
  }

  // 替换 Windows/Linux 非法字符: < > : " / \ | ? *
  // 同时也替换控制字符
  // eslint-disable-next-line no-control-regex
  return fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
}
