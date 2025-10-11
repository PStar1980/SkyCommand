SkyServer

SkyServer is a backend service for orchestrating the ingestion, processing and storage of AI‑driven tasks.
It consumes tasks from an ingestion queue, dispatches them to an AI engine for generation or transformation,
and persists the resulting outputs and metadata to disk. The service includes scheduling, logging, configuration
management and data management components to ensure reliable and reproducible processing runs.


Architecture

SkyServer is composed of several Python modules and supporting directories:

SkyScheduler.py – orchestrates scheduled runs by reading pending tasks from the ingestion queue, spawning
processing jobs and ensuring concurrency control.

SkyServer.py – entry point that spins up the task processing service, handling task consumption and
communication with the AI engine.

SkyServer_Core.py – core processing logic for sending prompts to the AI engine, capturing responses
and handling retries and back‑off logic.

SkyServer_Logs.py – centralised logging and audit trail support. It writes detailed logs to the logs/
directory and surfaces metrics for monitoring.

config.json – central configuration file for environment variables, directory paths, concurrency parameters
and AI engine settings.

Data folders (data/, index/, logs/, processed/) – manage input datasets, intermediate index files,
log records and final processed results respectively.


Features

Automated task ingestion – monitors an ingestion queue and automatically picks up new tasks for processing.

Robust scheduling – supports scheduled and batch execution of tasks via SkyScheduler.py, with
configurable intervals and concurrency.

Prompt dispatch and result capture – handles sending prompts to the AI engine and captures responses
with retry logic and error handling.

Output persistence – writes processed results to structured JSON/CSV files under the processed/ directory
and updates indexes for quick lookups.

Extensive logging – logs detailed processing events, errors and performance metrics to facilitate
debugging and reproducibility.

Configurable settings – uses config.json to allow tuning of API keys, concurrency levels, directory
locations and other runtime parameters without modifying code.

Scalable design – separates scheduling, core processing and logging into distinct modules, making it
easier to extend or run components independently.


Releases

v1.0.0 – Initial release of SkyServer with core ingestion and processing pipeline, scheduling support and
improved reliability through comprehensive logging and error handling.


Usage

Install dependencies – ensure Python 3.8+ is installed along with any required packages
(e.g. requests, pandas, schedule, openai). Use pip install -r requirements.txt if a requirements
file is provided.

Configure the service – copy config.json to your working directory and update the fields for:

Paths to the data/, logs/, index/ and processed/ directories.

Credentials or API keys for the AI engine.

Ingestion queue parameters and concurrency settings.

Run scheduled processing – launch the scheduler with:

python SkyScheduler.py


The scheduler will run periodically according to the configured schedule, pick up pending tasks and launch
worker processes.

Run ad‑hoc processing – to process a single batch immediately, run:

python SkyServer.py


This will spin up a processing loop that consumes tasks from the queue until none remain.

Monitor logs and results – inspect log files under logs/ for detailed execution traces. Processed
results and any generated index files will be written to processed/ and index/ directories.

For more detailed instructions, consult the inline comments in each Python module and the settings in
config.json.