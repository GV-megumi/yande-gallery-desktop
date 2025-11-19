// 测试MoebooruClient连接
import { MoebooruClient } from './build/main/services/moebooruClient.js';
import { getBooruSiteById } from './build/main/services/booruService.js';

async function testConnection() {
  try {
    console.log('获取站点信息...');
    const site = await getBooruSiteById(1);
    console.log('站点信息:', JSON.stringify(site, null, 2));

    console.log('\n创建MoebooruClient...');
    const client = new MoebooruClient({
      baseUrl: site.url,
      login: site.username,
      passwordHash: site.passwordHash
    });

    console.log('\n发起请求...');
    const posts = await client.getPosts({ page: 1, limit: 5 });
    console.log('成功获取', posts.length, '张图片');
  } catch (error) {
    console.error('错误:', error.message);
    console.error('错误详情:', error);
  }
}

testConnection();
