<!-- source: https://dev.twitch.tv/docs/tutorials/extension-101-tutorial-series/build-backend/ -->

Contents

# Extension 101 tutorial series

# Build Your Backend  {#build-your-backend}

We will now move on to integrating a backend for your Extension. Having a backend is important if you want to a) process business logic that shouldn’t be exposed to the front end or b) establish connections and integrations into other services such as a database. Extension backends can be in any language, use any hosting, and utilize any database.

In this tutorial, we will be building a backend to save the questions the viewers submitted and display them to the broadcaster via the live configuration page on the dashboard.

Software used in this tutorial includes:

- [MongoDB](https://www.mongodb.com/): a simple NoSQL database
- [Mongoose](https://mongoosejs.com/): Object Data Modeling Library
- [Express](https://expressjs.com/): a Node.js framework
- The following additional libraries: [body-parser](https://mongoosejs.com/), JSONWebToken
- homebrew

**Note:** You can use any database service that you are familiar with.

## Step 1: Set up Your System  {#step-1-set-up-your-system}

- Install Node.js. Please refer to tutorial 4 for directions on how to install it.
- Install MongoDB locally. A quick way to install MongoDB is to use homebrew.
- We also need to install libraries we will need (Express, Mongoose, Body-Parser, and JSONWebToken) via the Node Package Manager (NPM). Open your terminal and navigate to the local project directory.
Enter the following commands:

```
npm init -yes
npm install express mongoose body-parser jsonwebtoken --save

```

**Note:** Even though we are installing the `jsonwebtoken` library here, we won’t be using it until the next section.

## Step 2: Understanding the Backend.js starter code  {#step-2-understanding-the-backendjs-starter-code}

We provided some of the basic code needed to set up Express and Mongoose in backend.js. Let’s take a second to understand what we are doing in this provided starter code.

### Importing Libraries  {#importing-libraries}

On lines 2-4, we have imported the necessary libraries that we will use: `express`, `Mongoose`, `body-parser`, and `jsonwebtoken`.

#### Express  {#express}

- **Create an Express App**: On lines 8-10, we create an express app.
- **Start the Server**: On lines 13-15, we use [`app.listen`](https://expressjs.com/en/api.html#app.listen) to start the server and listen on the defined port of 3000.
- **Use body parser**: On line 18, we use [`body-parser`](https://expressjs.com/en/resources/middleware/body-parser.html), which helps parse incoming HTTP request bodies. We’ll see this being utilized more directly in the next step.

#### Mongoose  {#mongoose}

- **Connect to Mongoose**: On line 24, we connect to mongoose using the `mongoose.connect()` [method](https://mongoosejs.com/docs/connections.html). The first argument we pass into this method is the URI Connection String, which tells Mongoose where to connect to. Specifically, we are connecting to “mongodb://localhost:27017/WYR-test,” where localhost:27017 is the default host where the `mongod` instance is running, and WYR-test is the database we want to save the information to,
- **Define Mongoose Model**: In lines 26-29, we are creating a [Model](https://mongoosejs.com/docs/models.html). Models in Mongoose are classes that define our database schema. Thus, the first argument we pass into the model method, provides the name of the collection, and the second argument is our schema that defines the properties of the documents. So in this function, we are creating a Question collection, that’s made of documents that each have properties to represent the two WYR dilemmas the users selected. The language of model, collection, and documents can be confusing but we can just view documents as a subset of collections, and collections as a subset of models!

**Note:** We recommend looking at additional resources such as the [Mongoose](https://mongoosejs.com/docs/index.html) and [Express](https://expressjs.com/en/starter/hello-world.html) Getting Started tutorials for a deeper understanding of how we are building this backend.

## Step 3: Submitting questions to the database  {#step-3-submitting-questions-to-the-database}

Now that we’ve set up our basic Mongoose and Express backend, we will use this framework to save the questions the users submit.

When a user clicks the submit button in the panel view, we need to send an [AJAX request](https://www.w3schools.com/xml/ajax_xmlhttprequest_send.asp) to the backend. Add the following function to `viewer.js`:

Through this function, a [POST request](https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods/POST) is sent to the given URL with the specified data. Going back to the Mongoose vocabulary we defined earlier: whenever a user submits a question, we want to enter a document into the defined Question collection. Let’s see how the backend takes care of this.

The AJAX request is sent to the provided URL which points to the Express `app.post()` routing method. In this routing method, we have handler function `/question` that is called when the POST request is received. Add this method to the `backend.js` file.

In this method, we use the body of the request, which contains the user’s options to create the myData document, an instance of the Question model. We can easily view and parse the user’s options from the body of the request because of the body-parser package we imported. We then use the [save function](https://mongoosejs.com/docs/api/model.html#model_Model-save) to save the newly created document to the database as a JSON object.

## Step 4: Displaying submitted questions on Live Config Page  {#step-4-displaying-submitted-questions-on-live-config-page}

Now that we’ve saved the user’s submitted questions, we want the broadcaster to be able to view these questions in the live configuration page. Right now, the live config page displays a button. Once the broadcaster clicks this button, they should be able to see all the submitted questions from different viewers. Add the following function to `live_config.js`.

Through this function, a [GET request](https://developer.mozilla.org/en-US/docs/Web/HTTP/Methods/GET) is sent to the given URL. We want to retrieve all the documents in the defined Question collection. Once this request is handled successfully, we want to change the UI from displaying a button to displaying the submitted questions. Lines 7-13 handle this.

The AJAX request is sent to the provided URL which points to the Express `app.get() `routing method. In this routing method, we have handler function `/questions` that is called when the GET request is received. Add this method to the `backend.js` file.

In this method, we use the [find function](https://mongoosejs.com/docs/api.html#model_Model.find) to find all documents in the collection, and send them back in the response.

**Check**: Code until this point is available on [Step 2 Branch](https://github.com/sonia145/extensions-101/tree/step-2).

Before we test it, we have to explore a very important topic of how we can keep this communication between the frontend and the backend secure!

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
