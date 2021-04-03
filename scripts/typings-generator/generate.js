// I wrote code too tired
// For me it was torture
// I wanted to finish as soon as possible
// So what quality do not want to answer
// I hope in the future I will rewrite it
// eslint-disable-next-line import/no-extraneous-dependencies
const ts = require('typescript');

const createPrinter = require('./printer');
const {
	TypesGenerator,
	InterfaceGenerator
} = require('./generators');

const {
	parseParameters,
	parseResponses,
	parseJSONSchema
} = require('./parsers');

const {
	readJSONFile,
	toPascalCase,
	upperFirstLetter,
	formatTSComments
} = require('./utils/helpers');

const METHODS_FILE = 'methods.ts';
const PARAMS_FILE = 'params.ts';
const OBJECTS_FILE = 'objects.ts';
const RESPONSES_FILE = 'responses.ts';
const CONSTANTS_FILE = 'constants.ts';

const typeingsDir = '../../packages/vk-io/src/api/schemas';

async function generate() {
	const [
		{ methods },
		{ definitions: responses },
		{ definitions: objects },
		{ errors }
	] = await Promise.all([
		readJSONFile('./schemas/methods.json'),
		readJSONFile('./schemas/responses.json'),
		readJSONFile('./schemas/objects.json'),
		readJSONFile('./schemas/errors.json')
	]);

	const { writeNode: writeMethodsNode } = createPrinter(`${typeingsDir}/${METHODS_FILE}`);
	const { writeNode: writeParamsNode } = createPrinter(`${typeingsDir}/${PARAMS_FILE}`);
	const { writeNode: writeResponsesNode } = createPrinter(`${typeingsDir}/${RESPONSES_FILE}`);
	const { writeNode: writeObjectsNode } = createPrinter(`${typeingsDir}/${OBJECTS_FILE}`);
	const { writeNode: writeConstantsNode } = createPrinter(`${typeingsDir}/${CONSTANTS_FILE}`);

	const paramsIdentifier = ts.createIdentifier('Params');
	const objectsIdentifier = ts.createIdentifier('Objects');
	const responsesIdentifier = ts.createIdentifier('Responses');

	writeParamsNode(
		ts.createImportDeclaration(
			undefined,
			undefined,
			ts.createImportClause(
				ts.createNamespaceImport(
					objectsIdentifier
				)
			),
			ts.createStringLiteral(`./${OBJECTS_FILE.replace('.ts', '')}`)
		)
	);

	writeResponsesNode(
		ts.createImportDeclaration(
			undefined,
			undefined,
			ts.createImportClause(
				ts.createNamespaceImport(
					objectsIdentifier
				)
			),
			ts.createStringLiteral(`./${OBJECTS_FILE.replace('.ts', '')}`)
		)
	);

	writeMethodsNode(
		ts.createImportDeclaration(
			undefined,
			undefined,
			ts.createImportClause(
				ts.createNamespaceImport(
					paramsIdentifier
				)
			),
			ts.createStringLiteral(`./${PARAMS_FILE.replace('.ts', '')}`)
		)
	);

	writeMethodsNode(
		ts.createImportDeclaration(
			undefined,
			undefined,
			ts.createImportClause(
				ts.createNamespaceImport(
					responsesIdentifier
				)
			),
			ts.createStringLiteral(`./${RESPONSES_FILE.replace('.ts', '')}`)
		)
	);

	const apiGroups = {};
	const apiParams = [];

	for (const method of methods) {
		const [groupName, methodName] = method.name.split('.');

		const camelizedGroupName = upperFirstLetter(groupName);
		const camelizedMethodName = upperFirstLetter(methodName);
		const camelizedCategory = camelizedGroupName + camelizedMethodName;

		if (!(groupName in apiGroups)) {
			apiGroups[groupName] = new InterfaceGenerator({
				name: `API${camelizedGroupName}`,
				description: formatTSComments(`The API ${groupName} group`)
			});
		}

		const params = new InterfaceGenerator({
			name: `${camelizedCategory}Params`
		});

		for (const parsedParameter of parseParameters(method.parameters, {
			namespace: objectsIdentifier
		})) {
			params.addProperty(parsedParameter);
		}

		params.methods.push(
			ts.createIndexSignature(
				undefined,
				undefined,
				[ts.createParameter(
					undefined,
					undefined,
					undefined,
					'key',
					undefined,
					ts.createKeywordTypeNode(
						ts.SyntaxKind.StringKeyword
					)
				)],
				ts.createKeywordTypeNode(
					ts.SyntaxKind.AnyKeyword
				)
			)
		);

		apiParams.push(params);

		const group = apiGroups[groupName];

		group.addMethod({
			name: methodName,
			description: method.description && formatTSComments(method.description),
			parameters: [
				TypesGenerator.parameter({
					name: 'params',
					type: ts.createQualifiedName(
						paramsIdentifier,
						params.name
					),
					required: true
				})
			],
			result: TypesGenerator.promiseType(
				ts.createQualifiedName(
					responsesIdentifier,
					ts.createIdentifier(
						toPascalCase(
							(method.responses.response || method.responses.keyResponse).$ref
								.replace(
									'responses.json#/definitions/',
									''
								)
						)
					)
				)
			)
		});
	}

	for (const response of parseResponses(responses, { namespace: objectsIdentifier })) {
		writeResponsesNode(
			response.kind === 'interface'
				? response.type.toASTNode({ exported: true })
				: TypesGenerator.declarationExport(
					ts.createTypeAliasDeclaration(
						undefined,
						ts.createModifier(
							ts.SyntaxKind.DeclareKeyword
						),
						response.name,
						undefined,
						response.type
					)
				)
		);
	}

	for (const object of parseJSONSchema(objects)) {
		if (object.exportedNodes) {
			for (const exportedNode of object.exportedNodes) {
				writeObjectsNode(exportedNode);
			}
		}

		writeObjectsNode(
			object.kind === 'interface'
				? object.type.toASTNode({ exported: true })
				: TypesGenerator.declarationExport(
					ts.createTypeAliasDeclaration(
						undefined,
						undefined,
						toPascalCase(object.name),
						undefined,
						object.type
					)
				)
		);
	}

	// writeConstantsNode

	writeConstantsNode(
		TypesGenerator.declarationExport(
			ts.createEnumDeclaration(
				undefined,
				undefined,
				'APIErrorCode',
				Object.entries(errors)
					.map(([name, info]) => (
						ts.addSyntheticLeadingComment(
							ts.createEnumMember(
								name.substring(10).toUpperCase(),
								ts.createNumericLiteral(
									String(info.code)
								)
							),
							ts.SyntaxKind.MultiLineCommentTrivia,
							formatTSComments(`${info.description}\n\nCode: \`${info.code}\``),
							true
						)
					))
			)
		)
	);

	const apiMethodsInterface = new InterfaceGenerator({
		name: 'APIMethods'
	});

	for (const [name, group] of Object.entries(apiGroups)) {
		writeMethodsNode(
			group.toASTNode({
				exported: true
			})
		);

		apiMethodsInterface.addProperty({
			name,
			type: group.name,
			description: group.description,
			required: true
		});
	}

	for (const params of apiParams) {
		writeParamsNode(
			params.toASTNode({
				exported: true
			})
		);
	}

	writeMethodsNode(
		apiMethodsInterface.toASTNode({
			exported: true
		})
	);

	// eslint-disable-next-line no-console
	console.log('Schema successful generated!');
}

generate().catch((error) => {
	// eslint-disable-next-line no-console
	console.error('Could not generate schema', error);

	process.exit(1);
});
