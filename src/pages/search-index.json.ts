import { getCollection } from 'astro:content';
import { getPostDescription, getPostTags } from '../utils/post';

export async function GET() {
	const posts = (await getCollection('blog')).sort(
		(a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
	);

	const searchData = posts.map((post) => ({
		id: post.id,
		title: post.data.title,
		date: post.data.pubDate.toLocaleDateString('zh-CN', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		}),
		desc: getPostDescription(post) || '',
		tags: getPostTags(post),
		url: `/blog/${post.id}/`,
	}));

	return new Response(JSON.stringify(searchData), {
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'public, max-age=3600',
		},
	});
}
