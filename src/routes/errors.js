

module.exports = ({app, log}) => {

  app.post('/errors', (req, res) => {
    const {scope, path, error, component} = req.body
    const user = {
      id: req.user?.id,
      fullname: req.user?.fullname || 'anonymous',
    }
    log.error({user, path, error, component, scope}, `app error from ${user.fullname}:`, error.name, error.message)
    res.status(200).send({msg: 'recorded'})
  })

}
