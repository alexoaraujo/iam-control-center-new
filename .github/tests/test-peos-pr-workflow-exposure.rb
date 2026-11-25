#!/usr/bin/env ruby
# frozen_string_literal: true
require_relative '../scripts/peos-pr-workflow-exposure'
def check(condition)
  raise 'contract failed' unless condition
end
def scan(body)
  PEOSWorkflowExposure.scan(body)
end
def flags(result)
  result.flat_map { |f| f['flags'] }
end
fixture = <<~'YAML'
  on: pull_request
  permissions:
    contents: read
  jobs:
    example:
      environment: Preview
      permissions:
        id-token: write
      steps:
        - uses: actions/checkout@abc
        - run: echo test
          env:
            TOKEN: ${{ secrets.VERCEL_API_TOKEN }}
            DB: ${{ secrets['NEON_OWNER_URL'] }}
YAML
r = scan(fixture)
check(r[0]['secret_names'] == %w[NEON_OWNER_URL VERCEL_API_TOKEN])
check(flags(r).include?('OIDC_CAPABILITY_REVIEW'))
check(flags(r).include?('ENVIRONMENT_REACHABLE_FROM_PR_EVENT'))
check(flags(r).include?('CHECKOUT_PERSISTED_CREDENTIALS_REVIEW'))
check(scan(fixture.sub('pull_request', 'workflow_dispatch')).empty?)
check(flags(scan(fixture.sub('pull_request', 'pull_request_target'))).include?('SECRET_REFERENCE'))
check(flags(scan(fixture.sub('secrets.VERCEL_API_TOKEN', 'secrets[inputs.name]'))).include?('DYNAMIC_SECRET_CONTEXT'))
check(flags(scan("on: workflow_call\njobs:\n  a:\n    uses: ./.github/workflows/example.yml\n    secrets: inherit\n")).include?('INHERITED_SECRETS'))
check(flags(scan("on: [pull_request]\njobs:\n  a:\n    environment: ${{ inputs.environment }}\n    steps: []\n")).include?('DYNAMIC_OR_UNKNOWN_ENVIRONMENT'))
check(!flags(scan("on: [pull_request]\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@abc\n        with:\n          persist-credentials: false\n")).include?('CHECKOUT_PERSISTED_CREDENTIALS_REVIEW'))
check(flags(scan('invalid: [')).include?('WORKFLOW_PARSE_OR_SHAPE_UNVERIFIED'))
check(!JSON.generate(scan(fixture.sub('echo test', 'echo NEVER_PRINT_ME'))).include?('NEVER_PRINT_ME'))
puts 'PASS 12 workflow exposure diagnostic assertions'
