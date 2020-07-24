import createDebug from 'debug';

import { APIWorker } from './worker';

import { APIRequest } from '../request';
import { delay } from '../../utils/helpers';
import {
	IExecuteErrorOptions,

	APIError,
	ExecuteError,

	APIErrorCode
} from '../../errors';

import { CaptchaType, MINIMUM_TIME_INTERVAL_API } from '../../utils/constants';

const debug = createDebug('vk-io:api');

export class SequentialWorker extends APIWorker {
	protected async execute(request: APIRequest | undefined = this.queue.shift()): Promise<void> {
		if (!request) {
			return;
		}

		const { method } = request;

		debug(`${method} -->`);

		let response;
		try {
			response = await request.make();
		} catch (error) {
			const { options } = this.vk;

			if (request.retries === options.apiRetryLimit) {
				debug(`${method} <X-`);

				request.captchaValidate?.reject(error);

				request.reject(error);

				return;
			}

			request.retries += 1;

			await delay(options.apiWait);

			debug(`Request ${method} restarted ${request.retries} times`);

			this.requeue(request);

			return;
		}

		debug(`${method} <--`);

		if (response.error !== undefined) {
			this.handleError(request, new APIError(response.error));

			return;
		}

		request.captchaValidate?.resolve();

		if (method.startsWith('execute')) {
			request.resolve({
				response: response.response,
				errors: (response.execute_errors || []).map((error: IExecuteErrorOptions) => (
					new ExecuteError(error)
				))
			});

			return;
		}

		request.resolve(response.response ?? response);
	}

	/**
	 * Error API handler
	 */
	public async handleError(request: APIRequest, error: APIError): Promise<void> {
		const { code } = error;

		if (code === APIErrorCode.TOO_MANY) {
			if (this.paused) {
				this.requeue(request);

				return;
			}

			this.pause();

			await delay(MINIMUM_TIME_INTERVAL_API);

			this.requeue(request);

			this.resume();

			return;
		}

		request.captchaValidate?.reject(error);

		if (code === APIErrorCode.AUTH_VALIDATION) {
			if (this.paused) {
				this.requeue(request);
			}

			let AccountVerification;
			try {
				AccountVerification = (await import('@vk-io/authorization')).AccountVerification;
			} catch (importError) {
				request.reject(error);

				return;
			}

			this.pause();

			try {
				// @ts-expect-error
				const verification = new AccountVerification(this.vk);

				const { token } = await verification.run(error.redirectUri!);

				debug('Account verification passed');

				this.vk.setOptions({ token });

				this.resume();

				this.requeue(request);
			} catch (verificationError) {
				debug('Account verification error', verificationError);

				request.reject(error);

				await delay(15e3);

				this.resume();
			}

			return;
		}

		if (code !== APIErrorCode.CAPTCHA || !this.vk.callbackService.hasCaptchaHandler) {
			request.reject(error);

			return;
		}

		try {
			const { captchaSid } = error;

			const { key, validate } = await this.vk.callbackService.processingCaptcha({
				type: CaptchaType.API,
				src: error.captchaImg!,
				sid: captchaSid!,
				request
			});

			request.captchaValidate = validate;

			request.params.captcha_sid = captchaSid;
			request.params.captcha_key = key;

			this.requeue(request);
		} catch (e) {
			request.reject(e);
		}
	}
}
