import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: "https://dominicchm.github.io",
	base: "/daq-2023/",
	output: 'static',
	outDir: '../docs',

	build: {
		assets: "astro"
	},

	integrations: [
		starlight({
			title: 'My Docs',
			social: {
				github: 'https://github.com/withastro/starlight',
			},
			sidebar: [
				{
					label: 'Overview',
					autogenerate: { directory: 'overview' },
				},
				{
					label: 'Runs',
					autogenerate: { directory: 'runs' },
				},
				// {
				// 	label: 'Reference',
				// 	items: [
				// 		// Each item here is one entry in the navigation menu.
				// 		{ label: 'Test', link: '/runs/test/' },
				// 	],
				// },
			],
		}),
	],
});
