module.exports =
{
	mode: 'modules',
	out: 'docs', // GitHub Pages dir
	listInvalidSymbolLinks: true,
	excludePrivate: true,
	excludeProtected: true,
	stripInternal: true, // See tsconfig.json.
	disableSources: true,
	readme: 'none',
	includeVersion: true,
	entryPoint: '"fhem-client"' // No modules overview since we have just one.
};
