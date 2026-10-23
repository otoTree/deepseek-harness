/** Include the supported dsh launcher in the API's production dependency deployment. */
module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === '@deepseek-ai/dsh-enterprise-api') {
        pkg.dependencies['@deepseek-ai/dsh'] = 'workspace:*'
      }
      return pkg
    },
  },
}
