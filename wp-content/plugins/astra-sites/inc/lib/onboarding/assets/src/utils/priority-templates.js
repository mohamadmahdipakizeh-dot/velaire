/**
 * Priority template pinning utility.
 *
 * Reorders search results so that priority templates (e.g. SureCart ecommerce)
 * appear at the top when the search term matches configured keywords.
 * Priority templates are sorted by publish-date (latest first) within their group.
 *
 * Configuration is read from astraSitesVars.priorityTemplates, which is shipped
 * by the server and gated behind the astra_sites_priority_templates_enabled filter.
 *
 * @since x.x.x
 */

/**
 * Check if a search term matches any priority category keyword.
 *
 * @param {string} searchTerm Current search term.
 * @return {string|null} Matched category slug, or null if no match.
 */
const getMatchedPriorityCategory = ( searchTerm ) => {
	const config = window.astraSitesVars?.priorityTemplates;
	if ( ! config?.priorityCategoryKeywords ) {
		return null;
	}

	const normalizedTerm = searchTerm.toLowerCase().trim();
	if ( ! normalizedTerm ) {
		return null;
	}

	for ( const [ categorySlug, keywords ] of Object.entries(
		config.priorityCategoryKeywords
	) ) {
		if ( ! Array.isArray( keywords ) ) {
			continue;
		}
		const matched = keywords.some( ( keyword ) =>
			normalizedTerm.includes( keyword.toLowerCase() )
		);
		if ( matched ) {
			return categorySlug;
		}
	}

	return null;
};

/**
 * Apply priority pinning to search results.
 *
 * When the search term matches a priority category keyword, templates whose IDs
 * appear in the priority list are moved to the front of the results. Within the
 * priority group, templates are sorted by publish-date descending (latest first).
 *
 * @param {Object|Array} sites      Sites object/array from search results.
 * @param {string}       searchTerm Current search term.
 * @return {Object|Array} Reordered sites with priority templates pinned to top.
 */
export const applyPriorityPinning = ( sites, searchTerm ) => {
	if ( ! sites || ! Object.keys( sites ).length ) {
		return sites;
	}

	const matchedCategory = getMatchedPriorityCategory( searchTerm );
	if ( ! matchedCategory ) {
		return sites;
	}

	const config = window.astraSitesVars?.priorityTemplates;
	const priorityIds =
		config?.priorityTemplatesByCategory?.[ matchedCategory ];
	if ( ! Array.isArray( priorityIds ) || ! priorityIds.length ) {
		return sites;
	}

	// Build a Set of priority IDs in "id-{N}" format for fast lookup.
	const priorityIdSet = new Set( priorityIds.map( ( id ) => `id-${ id }` ) );

	const entries = Object.entries( sites );
	const priorityEntries = [];
	const restEntries = [];

	for ( const entry of entries ) {
		if ( priorityIdSet.has( entry[ 0 ] ) ) {
			priorityEntries.push( entry );
		} else {
			restEntries.push( entry );
		}
	}

	if ( ! priorityEntries.length ) {
		return sites;
	}

	return Object.fromEntries( [ ...priorityEntries, ...restEntries ] );
};
