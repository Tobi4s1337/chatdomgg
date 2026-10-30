<!-- source: https://dev.twitch.tv/docs/extensions/load-testing-extensions/ -->

Contents

# Load Testing Extensions Using Locust and Elastic Beanstalk  {#load-testing-extensions-using-locust-and-elastic-beanstalk}

Reviews for chatbot verification continue to be temporarily paused while we revise our processes. Reviews for Extensions, developer organizations, and game ownership have resumed. Thank you for your patience and understanding.

As of July 9th 2024, there is no longer a requirement to have an Apple Developer account, or fill out the "iOS Allowlist Request" form, to allow an Extension to work on the iOS version of the Twitch app. All mobile Extensions, existing and new, are available on iOS and Android without additional requirements in the submission process.

Extension developers often ask how to load test their EBS (Extensions Backend Service). In this guide, we discuss how to go about load testing using [Locust](https://locust.io/) and [Elastic Beanstalk](https://aws.amazon.com/elasticbeanstalk/). We have edited [this AWS guide](https://aws.amazon.com/blogs/devops/using-locust-on-aws-elastic-beanstalk-for-distributed-load-generation-and-testing/) to work specifically for extensions backend testing.

## Prerequisites  {#prerequisites}

- Create an AWS account.
- Set up a [load balancer](https://docs.aws.amazon.com/elasticloadbalancing/latest/classic/elb-getting-started.html).

## Setting up EBS testing on AWS  {#setting-up-ebs-testing-on-aws}

There are three main aspects to setting up EBS testing on AWS.

- Set up Locust
- Run your Locust test
- Scale your load tests

### Set up Locust  {#set-up-locust}

To set up Locust:

- Create a new t2 micro “Amazon Linux AMI 2018.03.0” instance and log into it.
- Install the [Elastic Beanstalk CLI](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/eb-cli3-install.html):
`pip install awsebcli --upgrade --user`
- [Configure your CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-configure.html#cli-quick-configuration):
`aws configure`
- Install git in your t2 micro instance:
`sudo yum install git`
- Clone the repository that contains the sample source code by running
`**git clone** **https://www.github.com/awslabs/eb-locustio-sample**`
- In the AWS Identity and Access Management (IAM) console, create an IAM instance profile named `aws-elasticbeanstalk-locust-role`.
For information on how to create an IAM instance profile, see [Create an IAM Instance Profile for Your Amazon EC2 Instances](https://docs.aws.amazon.com/codedeploy/latest/userguide/how-to-create-iam-instance-profile.html).
- Add the following policy to your instance profile:

```
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "VisualEditor0",
            "Effect": "Allow",
            "Action": [
                "elasticbeanstalk:DescribeEnvironmentResources",
                "elasticbeanstalk:DescribeEnvironments",
                "dynamodb:ListGlobalTables",
                "dynamodb:ListTables",
                "autoscaling:DescribeAutoScalingGroups",
                "dynamodb:ListBackups",
                "cloudformation:ListStackResources"
            ],
            "Resource": "*"
        },
        {
            "Sid": "VisualEditor1",
            "Effect": "Allow",
            "Action": [
                "dynamodb:CreateTable",
                "dynamodb:GetItem",
                "dynamodb:UpdateItem"
            ],
            "Resource": "arn:aws:dynamodb:*:*:table/*"
        }
    ]
  }
```

Once you have accomplished the previous steps, continue in the directory where you cloned the sample code. All the EB commands that follow must be run in this directory:

- Navigate to the directory `eb-locustio-sample`.
- Initialize the directory for use with the EB CLI by running the following command:
`eb init -r <region> -p "Java 8"`
Replace <region> with a region identifier such as us-west-2. For a full list of region identifiers, see [Regions and Endpoints](https://docs.amazonaws.cn/en_us/general/latest/gr/rande.html#elasticbeanstalk_region).

Alternatively, start interactive mode by running `eb init`, then following this procedure:

- Pick a region from the list.
- Choose **Create New Application**.
- Type a name for the application.
- When you are asked, “It appears you are using Python. Is this correct?” choose **No**.
- For platform, choose **Java**.
- For the platform version, choose **Java 8**.
- When you are asked, “Do you want to set up SSH for your instances?” choose **No**.
**Note**: If you choose to enable SSH and do not already have an SSH key stored on AWS, the command `ssh-keygen` must be available on the path as it is used by the EB CLI to generate the SSH key to be used.
- Create your load generation environment by running the following command. Replace <Test URL> with the URL of the web app that you want to test.
`**eb create <env-name> -i c4.large --scale 1 --envvars TARGET_URL=<Test-URL> --instance_profile aws-elasticbeanstalk-locust-role**`
**Note:** The scale CLI parameter shown previously here can be used to spin up more instances that can run as slaves to a master instance and provide higher throughput as needed for your testing needs. More details can be read in the “[Scaling your Load Tests](https://docs.google.com/document/d/1HNzz9N17fhB_E06fEW5JKHHHq3VD15o_gwubgyXJEpE/edit#heading=h.2hzx3yowgb2)” section.
- Type a name for the environment.
- Type the CNAME prefix that you want to use for this environment.

After the environment has been created, the logs will indicate the URL for the application. It usually follows a format like `CNAME.<region>.elasticbeanstalk.com`.

### Run your Locust test  {#run-your-locust-test}

Locust is a python script based framework for writing tests. If you would like to learn more about writing tests using Locust, see [Writing a locustfile](https://docs.locust.io/en/latest/writing-a-locustfile.html). The sample code you cloned previously includes a sample test definition that tests the root of the provided test URL every 45-50 milliseconds. We are now going to use a test definition better suited to testing your EBS.

- Navigate to the folder where you cloned the sample code.
- Replace the [locustfile.py](https://github.com/aws-samples/eb-locustio-sample/blob/master/locustfile.py) file with the following:

```
import os
import string
from locust import HttpLocust, TaskSet, task
class UserBehavior(TaskSet):
    @task
    def put_tests(self):
        response = self.client.post("/<Your path here>",
        headers={
#Your header values here
        },
data={
#Your POST data here
})
class WebsiteUser(HttpLocust):
    host = os.getenv(
        'TARGET_URL', "<DEFAULT URL HERE>")
    task_set = UserBehavior
```
- Save and commit the changes: `git commit -am "POSTing to my EBS"`
- Deploy your changes to the environment by running `eb deploy --staged`
- Once the environment update is complete, in a web browser, go to the URL you noted in Step 8 of the previous procedure.
- Run your test using the number of users and spawn rate as desired.

### Scale your load tests  {#scale-your-load-tests}

You can scale out your environment to more than one EC2 instance:

- Navigate to the folder where you cloned the sample code.
- Open the configuration file in the default editor by running `eb config`.
- Under the `aws:elasticbeanstalk:command` namespace, set the `BatchSize` to 100.
- Save the configuration file, and exit the editor to start the environment update.
- After the update completes, run `eb scale <number of instances>`. Replace <number of instances> with the number of EC2 instances that you want the environment to scale out to.
- After the additional instances have been added, run `eb deploy --staged`. Since Locust requires a single master, this step ensures that a single instance is selected as master after the environment has scaled out.
- To open the [Locust](https://locust.io/) dashboard and start your tests, in a web browser go to the URL you noted in Step 8 of the setup procedure.

 [Docs](https://dev.twitch.tv/docs) [Support](https://dev.twitch.tv/support) [Showcase](https://dev.twitch.tv/showcase) [Announcements](https://discuss.dev.twitch.com/c/announcements/)
