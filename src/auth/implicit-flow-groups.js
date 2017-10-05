import createDebug from 'debug';
import { load as cheerioLoad } from 'cheerio';

import { URL, URLSearchParams } from 'url';

import ImplicitFlow from './implicit-flow';
import { AuthError, authErrors } from '../errors';
import { API_VERSION, CALLBACK_BLANK } from '../util/constants';
import {
	parseFormField,
	getAllGroupsPermissions,
	getGroupsPermissionsByName
} from './helpers';

const debug = createDebug('vk-io:auth:implicit-flow-user');

const { AUTHORIZATION_FAILED } = authErrors;

export default class ImplicitFlowGroups extends ImplicitFlow {
	/**
	 * Constructor
	 *
	 * @param {VK}     vk
	 * @param {Object} options
	 */
	constructor(vk, options) {
		super(vk, options);

		let { groups = null } = options;

		if (groups === null) {
			throw Error('Groups list must have');
		}

		if (!Array.isArray(groups)) {
			groups = [groups];
		}

		this.groups = groups.map((group) => {
			if (typeof group !== 'number') {
				group = Number(group);
			}

			if (group < 0) {
				group = -group;
			}

			return group;
		});
	}
	/**
	 * Returns permission page
	 *
	 * @param {Array} groups
	 *
	 * @return {Response}
	 */
	getPermissionsPage() {
		const { app } = this.vk.options;
		let { scope } = this.vk.options;

		if (scope === 'all' || scope === null) {
			scope = getAllGroupsPermissions();
		} else if (typeof scope !== 'number') {
			scope = getGroupsPermissionsByName(scope);
		}

		debug('auth scope %s', scope);

		const params = new URLSearchParams({
			group_ids: this.groups.join(','),
			redirect_uri: CALLBACK_BLANK,
			response_type: 'token',
			display: 'page',
			v: API_VERSION,
			client_id: app,
			revoke: 1,
			scope
		});

		const url = new URL(`https://oauth.vk.com/authorize?${params}`);

		return this.fetch(url, {
			method: 'GET'
		});
	}

	/**
	 * Starts authorization
	 *
	 * @return {Promise<Array>}
	 */
	async run() {
		const { response } = await super.run();

		const { hash } = new URL(response.url);
		const params = new URLSearchParams(hash.substring(1));

		if (params.has('error')) {
			throw new AuthError({
				message: `Failed passed grant access: ${params.get('error_description') || 'Unknown error'}`,
				code: AUTHORIZATION_FAILED
			});
		}

		let expires = params.get('expires_in');

		if (expires !== null) {
			expires = Number(expires);
		}

		const tokens = [];

		for (const [name, value] of params) {
			if (!name.startsWith('access_token_')) {
				continue;
			}

			/* Example group access_token_XXXXX */
			const [,, group] = name.split('_');

			tokens.push({
				group: Number(group),
				token: value,
				expires
			});
		}

		return tokens;
	}
}
