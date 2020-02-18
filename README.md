# mongodbext-relations
mongodbext plugin that bring relations between collections

**options:**

* `relations` (required) - hash of fields that should be embedded, should be specified in format: `{field1: field1Options, field2: field2Options, ...}`.
Each field options could have properties:
    * `collection` (required) - instance of mongodbext collection, that should be embedded
    * `projection` - fields projection to embed (`{_id: 1}` by default`)
    * `key` - "primary key" field (`_id` by default)
    * `embedded` - function that used to create EmbeddedDocument instance (autogenerated by default)
    * `onDelete` - action that should be done on embedded document deletion, available actions: 'restrict', 'cascade', 'unset', 'pull', null ('restrict' by default)
    * `onUpdate` - action that should be done on embedded document updating, available actions: `cascade`, null ('cascade' by default)
    * `onReplace` - action that should be done on embedded document replacing, available actions: `cascade`, null ('cascade' by default)

**Example:**

``` js
var MongoClient = require('mongodb').MongoClient;
var mongodbext = require('mongodbext');
var mongodbextRelations = require('mongodbext-relations');

MongoClient.connect('mongodb://localhost:27017/test', function(err, db) {
    var authorsCol = new mongodbext.Collection(db, 'authors');
    var chaptersCol = new mongodbext.Collection(db, 'chapters');

    var booksCol = new mongodbext.Collection(db, 'books');
    booksCol.addPlugin(mongodbextRelations, {
        relations: {
            'author': {
                collection: authorsCol,
                projection: {_id: 1, name: 1}
            },
            'chapters.$': {
                collection: chaptersCol,
                projection: {_id: 1, title: 1}
            }
        }
    });

    var author = {
        _id: 1,
        name: 'John Doe',
        age: 42
    };

    var chapters = [{
        _id: 1,
        title: 'Chapter 1',
        page: 6
    }, {
        _id: 2,
        title: 'Chapter 2',
        page: 100
    }];

    var book = {
        _id: 1,
        title: 'Book',
        author: 1,
        chapters: [1, 2]
    };

    authorsCol.insertOne(author, function() {
        chaptersCol.insertMany(chapters, function() {
            booksCol.insertOne(book, function(err, book) {
                console.log(book);
                // {
                //   _id: 1,
                //   title: 'Book',
                //   author: { _id: 1, name: 'John Doe' },
                //   chapters: [
                //     { _id: 1, title: 'Chapter 1' },
                //     { _id: 2, title: 'Chapter 2' }
                //   ]
                // }

                chaptersCol.deleteOne({_id: 1}, function(err) {
                    console.log(err);
                    // [Error: Could not delete document from collection `chapters` because it is embedded to related collection `books` in the field `chapters` of document with _id=1]
                });
            });
        });
    });
});

```
