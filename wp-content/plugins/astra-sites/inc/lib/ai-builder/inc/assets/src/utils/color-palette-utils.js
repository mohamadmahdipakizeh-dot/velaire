import { __ } from '@wordpress/i18n';
import { DARK_PALETTES, LIGHT_PALETTES } from '../ui/colors';

/**
 * Get a random color palette for a template based on its color scheme.
 *
 * @param {Object} template - The template object with design_defaults.
 * @return {Object} A random palette object from the matching palette set.
 */
export const getRandomColorPaletteForTemplate = ( template ) => {
	const colorScheme = template?.design_defaults?.color_scheme;
	const isDark = Array.isArray( colorScheme )
		? colorScheme.length > 0
		: !! colorScheme;

	return getRandomFallbackPalette( isDark );
};

/**
 * Get a random palette from the dark or light palette set.
 *
 * @param {boolean} isDarkScheme - Whether to use dark palettes.
 * @return {Object} A random palette object.
 */
export const getRandomFallbackPalette = ( isDarkScheme ) => {
	const palettes = isDarkScheme ? DARK_PALETTES : LIGHT_PALETTES;
	const randomIndex = Math.floor( Math.random() * palettes.length );
	return palettes[ randomIndex ];
};

/**
 * Get the default (original) color palette for a template.
 *
 * @param {Object} template - The template object with design_defaults.
 * @return {Object|null} The default palette object, or null if unavailable.
 * @since x.x.x
 */
export const getDefaultColorPaletteForTemplate = ( template ) => {
	const colorPalette = template?.design_defaults?.color_palette;
	if ( ! colorPalette ) {
		return null;
	}

	const palettes = Object.values( colorPalette ).filter( Array.isArray );
	if ( ! palettes.length ) {
		return null;
	}

	return {
		id: 'default-0',
		slug: 'default',
		title: __( 'Original', 'ai-builder' ),
		colors: palettes[ 0 ],
	};
};
