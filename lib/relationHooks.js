'use strict';

var utils = require('./utils');

var hookWrapper = utils.createHookWrapper('relating');

var setupRelationHooks = function(relatedCollection, relation) {
	// before hooks are used to save original object identifiers
	// or to check restrictions
	var getModifiedIdentifiers = function(condition, callback) {
		var projection = utils.createObject(relation.key, true);

		relation.collection
			.find(condition, projection)
			.toArray(function(err, docs) {
				if (err) return callback(err);

				var identifiers = docs.map(function(doc) {
					return doc[relation.key];
				});

				callback(null, identifiers);
			});
	};

	var getTopLevelFields = function(fields) {
		return fields.map(function(field) {
			if (field.indexOf('.') >= 0) {
				return field.split('.')[0];
			}

			return field;
		});
	};

	var getModifiedFields = function(modifier) {
		if (utils.isModifier(modifier)) {
			return Object.keys(modifier).reduce(function(fields, key) {
				return fields.concat(
					getTopLevelFields(Object.keys(modifier[key]))
				);
			}, []);
		}

		return getTopLevelFields(Object.keys(modifier));
	};

	var shouldUpdate = function(modifier) {
		var projectionKeys = Object.keys(relation.projection),
			modifiedFields = getModifiedFields(modifier);

		return projectionKeys.filter(function(key) {
			return key !== relation.key;
		}).some(function(key) {
			return modifiedFields.indexOf(key) >= 0;
		});
	};

	var beforeUpdate = hookWrapper(function(params, callback) {
		params.meta.modifiedIdentifiers = params.meta.modifiedIdentifiers || {};

		if (
			relation.onUpdate === 'cascade' &&
			!params.meta.modifiedIdentifiers[relation.key] &&
			shouldUpdate(params.modifier || params.replacement)
		) {
			getModifiedIdentifiers(params.condition, function(err, identifiers) {
				if (err) return callback(err);

				params.meta.modifiedIdentifiers[relation.key] = identifiers;

				callback();
			});
		} else {
			callback();
		}
	});

	relation.collection.on('beforeUpdateOne', beforeUpdate);
	relation.collection.on('beforeReplaceOne', beforeUpdate);
	relation.collection.on('beforeUpsertOne', beforeUpdate);
	relation.collection.on('beforeUpdateMany', beforeUpdate);

	var afterUpdate = hookWrapper(function(params, callback) {
		var identifiers = params.meta.modifiedIdentifiers[relation.key] || [];

		if (!identifiers.length || !shouldUpdate(params.modifier || params.replacement)) {
			return callback();
		}

		if (relation.onUpdate === 'cascade' || relation.onReplace === 'cascade') {
			// in cascade mode we need to update each updated identifier
			var funcs = identifiers.map(function(identifier) {
				return function(callback) {
					var condition = utils.createObject(
						relation.paths.identifier,
						identifier
					);

					var modifier = {
						$set: utils.createObject(
							relation.paths.modifier,
							relation.embedder(identifier)
						)
					};

					relatedCollection.updateMany(condition, modifier, callback);
				};
			});

			utils.asyncParallel(funcs, callback);
		} else {
			callback();
		}
	});

	var afterUpsert = hookWrapper(function(params, callback) {
		if (!params.isUpdated) return callback();

		afterUpdate(params, callback);
	});

	relation.collection.on('afterUpdateOne', afterUpdate);
	relation.collection.on('afterReplaceOne', afterUpdate);
	relation.collection.on('afterUpsertOne', afterUpsert);
	relation.collection.on('afterUpdateMany', afterUpdate);

	var checkDeleteRestictions = function(identifiers, callback) {
		var condition = utils.createObject(
			relation.paths.identifier,
			{$in: identifiers}
		);

		relatedCollection.findOne(condition, {_id: 1}, function(err, doc) {
			if (err) return callback(err);

			if (doc) {
				return callback(
					new Error(
						'Could not delete document from collection ' +
						'`' + relation.collection.collectionName + '` ' +
						'because it is embedded to related collection ' +
						'`' + relatedCollection.collectionName + '` ' +
						'in the field `' + relation.paths.field + '` of document ' +
						'with ' + relation.key + '=' + doc._id
					)
				);
			}

			callback();
		});
	};

	var beforeDelete = hookWrapper(function(params, callback) {
		if (
			relation.onDelete === 'restrict' || relation.onDelete === 'cascade' ||
			relation.onDelete === 'unset' || relation.onDelete === 'pull'
		) {
			getModifiedIdentifiers(params.condition, function(err, identifiers) {
				if (err) return callback(err);

				params.meta.modifiedIdentifiers = identifiers;

				if (relation.onDelete === 'restrict') {
					checkDeleteRestictions(identifiers, callback);
				} else {
					callback();
				}
			});

		} else {
			callback();
		}
	});

	relation.collection.on('beforeDeleteOne', beforeDelete);
	relation.collection.on('beforeDeleteMany', beforeDelete);

	var afterDelete = hookWrapper(function(params, callback) {
		var identifiers = params.meta.modifiedIdentifiers || [];

		if (!identifiers.length) return callback();

		var condition = utils.createObject(
			relation.paths.identifier,
			{$in: identifiers}
		);

		if (relation.onDelete === 'cascade') {
			relatedCollection.deleteMany(condition, callback);
		} else if (
			relation.onDelete === 'unset' || relation.onDelete === 'pull'
		) {
			var modifier = {};

			if (relation.onDelete === 'unset') {
				modifier.$unset = utils.createObject(
					relation.paths.field,
					true
				);
			} else if (relation.onDelete === 'pull') {
				modifier.$pull = utils.createObject(
					relation.paths.field,
					utils.createObject(relation.key, {$in: identifiers})
				);
			}

			relatedCollection.updateMany(condition, modifier, callback);
		} else {
			callback();
		}
	});

	relation.collection.on('afterDeleteOne', afterDelete);
	relation.collection.on('afterDeleteMany', afterDelete);
};

exports.setup = function(collection, relations) {
	Object.keys(relations).forEach(function(field) {
		setupRelationHooks(collection, relations[field]);
	});
};
