# Why STAX?

Cloud engineering and DevOps teams solve many of the same CI/CD problems in every project: deploying infrastructure and services, generating releases, reviewing pull requests, running dry runs, and performing static code analysis. Rebuilding these workflows takes time. Keeping copied implementations in sync adds ongoing maintenance work.

Reusable GitHub Actions workflows and actions help reduce that duplication, but they still need project-specific integration. Teams must connect build and deployment steps, configure cloud authentication, manage access to external repositories, and coordinate the order in which components are deployed.

STAX aims to address these challenges by reducing repetitive setup and project-specific integration work. It goes beyond workflow reuse by letting teams describe infrastructure components and their relations in configuration files, making delivery easier to manage as projects grow.

## Bring related components together

A project rarely consists of a single deployment. It may combine infrastructure, container images, application builds, scripts, and Kubernetes deployments using manifests or Helm charts.

STAX organizes these units as **stacks**. The goal is to keep infrastructure provisioning and service delivery together, with a shared approach to configuration and orchestration across different technologies.

## Make dependencies explicit

Stacks often depend on one another. A cluster needs its network before it can be provisioned. A container deployment needs both a built image and a running target environment. Some stacks also need output values from earlier deployments, such as a resource identifier or service endpoint.

STAX aims to make these relationships explicit, so deployment order and the flow of values between stacks are part of the project configuration instead of custom coordination logic scattered across workflows.

## Start new projects with less setup

A consistent framework reduces the decisions and repetitive work involved in getting a project started. STAX aims to help teams bootstrap new projects, reuse deployment patterns, and extend their configuration as new components are added.

## Stay within GitHub

STAX draws inspiration from [Spacelift](https://spacelift.io/) and [Atmos](https://atmos.tools/), particularly their approaches to organizing infrastructure and coordinating stacks.

Its design goal is to provide that orchestration within GitHub Actions, without requiring a separate SaaS platform. Beyond GitHub and the services being deployed, a cloud storage service may be needed to hold values passed between stacks. This orchestration state is distinct from any infrastructure state managed by the underlying tools.
